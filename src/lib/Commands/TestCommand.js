/**
 * Test command
 */

'use strict';

//<editor-fold desc="imports">
const fs = require('fs');
const c = require('colors');
const path = require('path');
const glob = require('glob');
const Bundler = require('../Bundler');
const EventEmitter = require('events');
const randomWords = require('random-words');
const randomstring = require('randomstring');
const sprintf = require('sprintf-js').sprintf;
const BuildAPIClient = require('../BuildAPIClient');
const DeviceError = require('../Errors/DeviceError');
const AbstractCommand = require('./AbstractCommand');
const promiseWhile = require('../utils/promiseWhile');
const TestStateError = require('../Errors/TestStateError');
const TestMethodError = require('../Errors/TestMethodError');
const AgentRuntimeError = require('../Errors/AgentRuntimeError');
const DeviceRuntimeError = require('../Errors/DeviceRuntimeError');
const SessionFailedError = require('../Errors/SessionFailedError');
const DeviceDisconnectedError = require('../Errors/DeviceDisconnectedError');
//</editor-fold>

class TestCommand extends AbstractCommand {

  /**
   * @returns {{}}
   */
  get defaultOptions() {
    return {
      debug: false,
      config: '.imptest',
      testFrameworkFile: '', // path to test framework main file
      testCaseFile: null, // path to test case file, of empty test cases will be searched automatically
      startTimeout: 2 // [s]
    };
  }

  /**
   * Run command
   * @return {Promise}
   * @private
   */
  run() {
    return super.run()
      .then(() => {

        // find test case files
        const testFiles = this._findTestFiles();

        // pre-cache source code
        this._getSourceCode();

        let d = 0;

        return promiseWhile(
          () => d++ < this._config.values.devices.length,
          () => {
            return this._runDevice(d - 1, testFiles);
          }
        );

      });
  }

  _runDevice(deviceIndex, testFiles) {
    let t = 0;
    return promiseWhile(
      () => t++ < testFiles.length,
      () => {
        return this._runTestFile(testFiles[t - 1], deviceIndex);
      }
    );
  }

  /**
   * We're done with testing
   * @private
   */
  finish() {
    if (this._testingAbort) {
      // testing was aborted
      this._error('Testing Aborted: ' + this._testingAbortReason);
    }

    super.finish();
  }

  /**
   * @return {BuildAPIClient}
   * @private
   */
  _getBuildApiClient() {
    if (!this._client) {
      this._client = new BuildAPIClient({
        debug: this._options.debug,
        apiKey: this._config.values.apiKey
      });
    }

    return this._client;
  }

  /**
   * Find test files
   * @returns {[{name, path, type}]}
   * @private
   */
  _findTestFiles() {
    const files = [];
    let configCwd;

    const pushFile = file => {
      files.push({
        name: file,
        path: path.resolve(configCwd, file),
        type: /\bagent\b/i.test(file) ? 'agent' : 'device'
      });
    };

    let searchPatterns = '';

    // test file pattern is passed via cli
    if (this._options.testCaseFile) {
      // look in the current path
      configCwd = path.resolve('.');
      searchPatterns = this._options.testCaseFile;
    } else {
      // look in config file directory
      configCwd = this._config.dir;
      searchPatterns = this._config.values.tests;
    }

    if (typeof searchPatterns === 'string') {
      searchPatterns = [searchPatterns];
    }

    for (const searchPattern of searchPatterns) {
      for (const file of glob.sync(searchPattern, {cwd: configCwd})) {
        pushFile(file);
      }
    }

    if (files.length === 0) {
      throw new Error('No test files found');
    }

    this._debug(c.blue('Test files found:'), files);

    this._info(c.blue('Found ') +
               files.length +
               c.blue(' test file' +
               (files.length === 1 ? ':' : 's:')) + '\n\t'
               + files.map(e => e.name).join('\n\t')
    );

    return files;
  }

  /**
   * Read source code
   * @return {{agent, device}}
   * @private
   */
  _getSourceCode() {

    if (!this._agentSource || !this._deviceSource) {

      let sourceFilePath;

      if (this._config.values.agentFile) {
        sourceFilePath = path.resolve(this._config.dir, this._config.values.agentFile);

        /* [debug] */
        this._debug(c.blue('Agent source code file path: ') + sourceFilePath);
        /* [info] */
        this._info(c.blue('Agent source file: ')
                   + this._config.values.agentFile);

        this._agentSource = fs.readFileSync(sourceFilePath, 'utf-8').trim();
      } else {
        this._agentSource = '/* no agent source provided */';
      }

      if (this._config.values.deviceFile) {
        sourceFilePath = path.resolve(this._config.dir, this._config.values.deviceFile);

        /* [debug] */
        this._debug(c.blue('Device source code file path: ') + sourceFilePath);
        /* [info] */
        this._info(c.blue('Device source file: ')
                   + this._config.values.deviceFile);

        this._deviceSource = fs.readFileSync(sourceFilePath, 'utf-8').trim();
      } else {
        this._deviceSource = '/* no device source provided */';
      }

    }

    return {
      agent: this._agentSource,
      device: this._deviceSource
    };
  }

  /**
   * Read framework code
   * @return {string}
   * @private
   */
  _getFrameworkCode() {
    if (!this._frameworkCode) {
      this._frameworkCode = (new Bundler({debug: this._options.debug}))
        .process(this._options.testFrameworkFile);
    }

    return this._frameworkCode.trim();
  }

  /**
   * Run test file
   * @param {name, path, type} file
   * @param {name, path, type} deviceIndex
   * @returns {Promise}
   * @private
   */
  _runTestFile(file, deviceIndex) {

    this._blankLine();

    // init test session
    this._initTestSession();

    this._info(c.blue('Starting test session ') + this._session.id);

    // determine device
    const deviceId = this._config.values.devices[deviceIndex];

    this._info(c.blue('Using device ') +
               (deviceIndex + 1) + ' of ' +
               this._config.values.devices.length
               + c.blue(', id: ') + deviceId);

    /* [info] */
    this._info(c.blue('Using ') + file.type + c.blue(' test file ') + file.name);

    // create complete codebase

    // bootstrap code
    const bootstrapCode =
      `// bootstrap tests
imp.wakeup(${parseFloat(this._options.startTimeout) /* prevent log sessions mixing, allow service messages to be before tests output */}, function() {
  local t = ImpUnitRunner();
  t.readableOutput = false;
  t.session = "${this._session.id}";
  t.timeout = ${parseFloat(this._config.values.timeout)};
  t.stopOnFailure = ${!!this._config.values.stopOnFailure};
  // poehali!
  t.run();
});`;

    let agentCode, deviceCode;

    // triggers device code space usage message, which also serves as revision launch indicator for device
    const reloadTrigger = '// force code update\n"' + randomstring.generate(32) + '"';

    if ('agent' === file.type) {
      agentCode = this._getFrameworkCode() + '\n\n' +
                  this._getSourceCode().agent + '\n\n' +
                  fs.readFileSync(file.path, 'utf-8').trim() + '\n\n' +
                  bootstrapCode;
      deviceCode = this._getSourceCode().device + '\n\n' +
                   reloadTrigger;
    } else {
      deviceCode = this._getFrameworkCode() + '\n\n' +
                   this._getSourceCode().device + '\n\n' +
                   fs.readFileSync(file.path, 'utf-8').trim() + '\n\n' +
                   bootstrapCode + '\n\n' +
                   reloadTrigger;
      agentCode = this._getSourceCode().agent;
    }

    this._debug(c.blue('Agent code size: ') + agentCode.length + ' bytes');
    this._debug(c.blue('Device code size: ') + deviceCode.length + ' bytes');

    return this._runTestSession(deviceCode, agentCode, file.type);
  }

  /**
   * Initialize test session
   * @private
   */
  _initTestSession() {
    let sessionId = null;

    while (null === sessionId || (this._session && sessionId === this._session.id)) {
      sessionId = randomWords(2).join('-');
    }

    this._session = {
      id: sessionId,
      state: 'initialized',
      deviceCodespaceUsage: 0,
      failures: 0,
      assertions: 0,
      tests: 0,
      stop: false,
      error: false // overall error
    };
  }

  /**
   * Execute test via BuildAPI from prepared code
   *
   * @param {string} deviceCode
   * @param {string} agentCode
   * @param {"agent"|"device"} type
   * @return {Promise}
   * @private
   */
  _runTestSession(deviceCode, agentCode, type) {

    return new Promise((resolve, reject) => {

      const client = this._getBuildApiClient();

      // start reading logs
      this._readLogs(type, this._config.values.devices[0])
        .on('ready', () => {

          client.createRevision(this._config.values.modelId, deviceCode, agentCode)

            .then((body) => {
              this._info(c.blue('Created revision: ') + body.revision.version);
              return client.restartModel(this._config.values.modelId)
                .then(/* model restarted */() => {
                  this._debug(c.blue('Model restarted'));
                });
            })

            .catch((error) => {
              this._onError(error);
              reject(error);
            });

        })

        // session is over
        .on('done', () => {

          if (this._session.error) {
            this._info(c.red('Session ') + this._session.id + c.red(' failed'));
          } else {
            this._info(c.green('Session ') + this._session.id + c.green(' succeeded'));
          }

          if (this._testingAbort || this._session.error && !!this._config.values.stopOnFailure) {
            // stop testing cycle
            reject();
          } else {
            // proceed to next session
            resolve();
          }
        });

    });
  }

  /**
   * Read device logs, convert them to predefined types
   *
   * @param {"agent"|"device"} type
   * @param {string} deviceId
   * @returns {EventEmitter} Events: ready, done
   *
   * @private
   */
  _readLogs(type, deviceId) {
    const ee = new EventEmitter();

    // for historical reasons, device produce server.* messages
    const apiType = {agent: 'agent', device: 'server'}[type];

    this._getBuildApiClient().streamDeviceLogs(deviceId, (data) => {

        if (data) {

          for (const log of data.logs) {

            // xxx
            //console.log(c.yellow(JSON.stringify(log)));

            let m;
            const message = log.message;

            try {

              switch (log.type) {

                case 'status':

                  if (message.match(/Agent restarted/)) {
                    // agent restarted
                    this._onLogMessage('AGENT_RESTARTED');
                  } else if (m = message.match(/(Out of space)?.*?([\d\.]+)% program storage used/)) {
                    // code space used
                    this._onLogMessage('DEVICE_CODE_SPACE_USAGE', parseFloat(m[2]));

                    // out of code space
                    if (m[1]) {
                      this._onLogMessage('DEVICE_OUT_OF_CODE_SPACE');
                    }
                  } else if (message.match(/Device disconnected/)) {
                    this._onLogMessage('DEVICE_DISCONNECTED');
                  } else if (message.match(/Device connected/)) {
                    this._onLogMessage('DEVICE_CONNECTED');
                  } else {
                    this._onLogMessage('UNKNOWN', log);
                  }

                  break;

                // error
                case 'lastexitcode':
                  this._onLogMessage('LASTEXITCODE', message);
                  break;

                case 'server.log':
                case 'agent.log':

                  if (log.type.replace(/\.log$/, '') === apiType) {
                    if (message.match(/__IMPUNIT__/)) {
                      // impUnit message, decode it
                      this._onLogMessage('IMPUNIT', JSON.parse(message));
                    }
                  }

                  break;

                case 'server.error':
                  this._onLogMessage('AGENT_ERROR', message);
                  break;

                case 'device.error':
                  this._onLogMessage('DEVICE_ERROR', message);
                  break;

                case 'powerstate':
                  this._onLogMessage('POWERSTATE', message);
                  break;

                case 'firmware':
                  this._onLogMessage('FIRMWARE', message);
                  break;

                default:
                  this._onLogMessage('UNKNOWN', log);
                  break;
              }


            } catch (e) {

              this._onError(e);

            }

            // are we done?
            if (this._session.stop) {
              ee.emit('done');
              break;
            }
          }

        } else {
          // we're connected
          ee.emit('ready');
        }

        return !this._session.stop;
      })

      .catch((e) => {
        this._onError(e);
        ee.emit('error', {error: e});
      });

    return ee;
  }

  /**
   * Log output handler
   *
   * @param {string} type
   * @param {*} [value=null]
   * @private
   */
  _onLogMessage(type, value) {
    let m;

    switch (type) {

      case 'AGENT_RESTARTED':
        if (this._session.state === 'initialized') {
          // also serves as an indicator that current code actually started to run
          // and previous revision was replaced
          this._session.state = 'ready';
        }
        break;

      case 'DEVICE_CODE_SPACE_USAGE':

        if (!this._session.deviceCodespaceUsage !== value) {
          this._info(c.blue('Device code space usage: ') + sprintf('%.1f%%', value));
          this._session.deviceCodespaceUsage = value; // avoid duplicate messages
        }

        break;

      case 'DEVICE_OUT_OF_CODE_SPACE':
        this._onError(new DeviceError('Out of code space'));
        break;

      case 'LASTEXITCODE':

        if (this._session.state !== 'initialized') {
          if (value.match(/out of memory/)) {
            this._onError(new DeviceError('Out of memory'));
          } else {
            this._onError(new DeviceError(value));
          }
        }

        break;

      case 'DEVICE_ERROR':
        this._onError(new DeviceRuntimeError(value));
        break;

      case 'DEVICE_DISCONNECTED':
        this._onError(new DeviceDisconnectedError());
        break;

      case 'AGENT_ERROR':
        this._onError(new AgentRuntimeError(value));
        break;

      case 'POWERSTATE':
        // todo: researh if any actiones needed
        this._info(c.blue('Powerstate: ') + value);
        break;

      case 'FIRMWARE':
        // todo: researh if any actiones needed
        this._info(c.blue('Firmware: ') + value);
        break;

      case 'IMPUNIT':

        if (value.session !== this._session.id) {
          // skip messages not from the current session
          // ??? should an error be thrown?
          break;
        }

        switch (value.type) {
          case 'START':

            if (this._session.state !== 'ready') {
              throw new TestStateError('Invalid test session state');
            }

            this._session.state = 'started';
            break;

          case 'STATUS':

            if (this._session.state !== 'started') {
              throw new TestStateError('Invalid test session state');
            }

            if (m = value.message.match(/(.+)::setUp\(\)$/)) {
              // setup
              this._testLine(c.blue('Setting up ') + m[1]);
            } else if (m = value.message.match(/(.+)::tearDown\(\)$/)) {
              // teardown
              this._testLine(c.blue('Tearing down ') + m[1]);
            } else {
              // status message
              this._testLine(value.message);
            }

            break;

          case 'FAIL':

            if (this._session.state !== 'started') {
              throw new TestStateError('Invalid test session state');
            }

            this._onError(new TestMethodError(value.message));
            break;

          case 'RESULT':

            if (this._session.state !== 'started') {
              throw new TestStateError('Invalid test session state');
            }

            this._session.tests = value.message.tests;
            this._session.failures = value.message.failures;
            this._session.assertions = value.message.assertions;
            this._session.state = 'finished';

            const sessionMessage =
              `Tests: ${this._session.tests}, Assertions: ${this._session.assertions}, Failures: ${this._session.failures}`;

            if (this._session.failures) {
              this._testLine(c.red(sessionMessage));
              this._onError(new SessionFailedError('Session failed'));
            } else {
              this._testLine(c.green(sessionMessage));
            }

            this._session.stop = true;
            break;

        }

        break;

      default:
        this._info(c.blue('Message of type ') + value.type + c.blue(': ') + value.message);
        break;
    }
  }

  /**
   * Handle test error
   * @param {Error|string} error
   * @return {boolean} stop test session?
   * @private
   */
  _onError(error) {
    this._debug('Error type: ' + error.constructor.name);

    if (error instanceof TestMethodError) {

      this._testLine(c.red('Test Error: ' + error.message));
      if (this._session) this._session.stop = false;

    } else if (error instanceof TestStateError) {

      this._error(error);
      if (this._session) this._session.stop = true;

    } else if (error instanceof SessionFailedError) {

      if (this._session) this._session.stop = !!this._config.values.stopOnFailure;

    } else if (error instanceof DeviceDisconnectedError) {

      this._testLine(c.red('Device disconnected'));

      // todo: proceed to next device
      this._testingAbort = true; // global abort
      this._testingAbortReason = 'Device disconnected';
      if (this._session) this._session.stop = true;

    } else if (error instanceof DeviceRuntimeError) {

      this._testLine(c.red('Device Runtime Error: ' + error.message));
      if (this._session) this._session.stop = true;

    } else if (error instanceof AgentRuntimeError) {

      this._testLine(c.red('Agent Runtime Error: ' + error.message));
      if (this._session) this._session.stop = true;

    } else if (error instanceof DeviceError) {

      this._testLine(c.red('Device Error: ' + error.message));
      if (this._session) this._session.stop = true;

    } else if (error instanceof Error) {

      this._error(error.message);
      if (this._session) this._session.stop = true;

    } else {

      this._error(error);
      if (this._session) this._session.stop = true;

    }

    if (this._session) this._session.error = true;
    this._success = false;
  }

  /**
   * Print [test] message
   * @param {*} ...objects
   * @protected
   */
  _testLine() {
    this._log('test', c.grey, arguments);
  }

  /**
   * Print blank line
   * @private
   */
  _blankLine() {
    console.log(c.gray(''));
  }
}

module.exports = TestCommand;
