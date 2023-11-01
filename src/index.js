const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-id', ec2InstanceId);
}

async function start() {
  core.debug('index.start() start: Config object:' + JSON.stringify(config));

  const conf = config();
  core.debug('index.start() start: Config object after conf = config():' + JSON.stringify(config));
  core.debug('index.start() start: conf const content:' + JSON.stringify(conf));

  core.debug('index.start(): exec config.generateUniqueLabel()...');
  const label = config.generateUniqueLabel();
  core.debug('index.start(): config.generateUniqueLabel() = ' + label);

  const githubRegistrationToken = await gh.getRegistrationToken();
  const ec2InstanceId = await aws.startEc2Instance(label, githubRegistrationToken);
  setOutput(label, ec2InstanceId);
  await aws.waitForInstanceRunning(ec2InstanceId);
  await gh.waitForRunnerRegistered(label);
}

async function stop() {
  await gh.removeRunner();
  await aws.terminateEc2Instance();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
