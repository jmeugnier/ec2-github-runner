const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {

  const userData = [
    '#!/bin/bash'
  ];

  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    userData.push(...[
      'echo "=== RUN ec2-github-runner INIT SCRIPT (Existing github-runner Mode) ==="',
      `cd "${config.input.runnerHomeDir}"`,
      'echo "[ec2-github-runner] go to actions-runner folder: $(pwd)"'
    ]);
  }
  else {
    userData.push(...[
      'echo "=== RUN ec2-github-runner INIT SCRIPT (Install Mode) ==="',
      'mkdir actions-runner && cd actions-runner',
      'echo "[ec2-github-runner] create and go to actions-runner folder: $(pwd)"'
    ]);
  }

  userData.push(...[
    `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
    'echo "[ec2-github-runner] RUN $(pwd)/pre-runner-script.sh"',
    'source pre-runner-script.sh',
    'export RUNNER_ALLOW_RUNASROOT=1',
    'export HOME=$(pwd)',
    'export DOTNET_CLI_HOME=/tmp',
    'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
  ]);

  if (config.input.runnerHomeDir) {
    userData.push(...[
      'echo "[ec2-github-runner] Runner Environment Variables:"',
      'env'
    ]);
  }
  else {
    userData.push(...[
      `export RUNNER_VERSION=${config.input.runnerVersion}`,
      'echo "[ec2-github-runner] Runner Environment Variables:"',
      'env',
      'echo "[ec2-github-runner] Download https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz..."',
      'curl -O -L https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz'
    ]);
  }

  userData.push(...[
    'echo "[ec2-github-runner] Run GitHub Action $(pwd)/config.sh..."',
    `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
    'echo "[ec2-github-runner] === END INIT SCRIPT: Run GitHub Action $(pwd)/run.sh ==="',
    './run.sh'
  ]);

  return userData;
}


async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    BlockDeviceMappings: config.input.blockDeviceMappings,
    KeyName: config.input.keyName,
  };

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
