// MIT License
//
// Copyright 2016 Electric Imp
//
// SPDX-License-Identifier: MIT
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
// EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
// OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
// OTHER DEALINGS IN THE SOFTWARE.

/**
 * Test session
 *
 * Events:
 *  - message({type, message})
 *  - error(error)
 *  - warning(error)
 *  - start
 *  - testMessage
 *  - result
 *  - done
 */

'use strict';

const c = require('colors');
const syncExec = require('sync-exec');
const EventEmitter = require('events');
const Errors = require('./SessionErrors');
const randomWords = require('random-words');
const sprintf = require('sprintf-js').sprintf;
const DebugMixin = require('../../DebugMixin');

class Session extends EventEmitter {

  constructor() {
    super();
    DebugMixin.call(this);

    this.id = randomWords(2).join('-');
    this.state = 'initialized';
  }

  /**
   * Run test session
   *
   * @param {string} testType
   * @param {string} deviceId
   * @param {string} modelId
   * @param {string} deviceCode
   * @param {string} agentCode
   */
  run(testType, deviceId, modelId, deviceCode, agentCode) {

    var dCode = deviceCode.split("#line").join("//#line"),
      aCode = agentCode.split("#line").join("//#line");

    this.logParser.parse(testType, deviceId)

      .on('ready', () => {
        this._start(dCode, aCode, modelId, deviceId);
      })

      .on('log', (log) => {
        this._handleLog(log,
          (errorLine => this._getErrorDetails(testType, dCode, aCode, errorLine)));
      })

      .on('error', (event) => {
        this.emit('error', event.error);
      })

      .on('done', () => {
        this.stop = true;
      });
  }

  /**
   * According to the ElectricImp docs there are a lot of error messages
   * https://electricimp.com/docs/troubleshooting/errors/
   * There is no reason to check all of them
   * therefore the following code is looking for substring like
   * (line 123) | agent_code: 123 | devic_code: 123
   * in the error message and replace them on the correct one
   *
   * This is helper method to get the correct line number
   * and filename for error messages
   *
   * @param {string} testType
   * @param {string} deviceCode
   * @param {string} agentCode
   * @param {string} errorMsg
   *
   * @return {string} - an updated error message
   */
  _getErrorDetails(testType, dCode, aCode, errorMsg) {
    // Check that error message not empty
    if (!errorMsg)
      return errorMsg;
    // All logs without prefix will be interpreted as
    // agent or device log depend on the next variable:
    var isAgent = testType == "agent";
    // looking for the "(line 123)" like matches
    var lineMatches = errorMsg.match(/\(line \d+\)/g);
    // try device_code:123 and agent_code:123 matches
    if (lineMatches == null || lineMatches.length == 0) {
      lineMatches = errorMsg.match(/agent_code:\d+/g);
      if (lineMatches == null || lineMatches.length == 0) {
        lineMatches = errorMsg.match(/device_code:\d+/g);
        if (lineMatches == null || lineMatches.length == 0)
          return errorMsg;
        isAgent = false; // device_code:123
      } else
        isAgent = true; // agent_code:123
    }
    var codeBase = isAgent ? aCode : dCode;

    var lineItem = lineMatches[0];
    // this statement should never happen
    if (!lineItem)
      return errorMsg;

    // extract line number:
    var line = parseInt(lineItem.match(/\d+/)[0]);
    var resultFile = null, resultPos = 0;

    // Split code by lines and get the error code
    // real position and filename
    var codeLines = codeBase.split("\n");
    for (var i = 0; i < line && i < codeLines.length; ++i) {
      if (codeLines[i].indexOf("//#line ") == 0) {
        // parse line statement
        // "//#line 58 '/path/to/file.nut'
        var lNums = codeLines[i].match(/\d+/g);
        lNums = parseInt(lNums[0]); // line number shift is a first number in match
        lNums = lNums > 1 ? lNums - 1 : 1;// descrese on 1 line number
        resultPos = line - i + lNums - 2; // builder could skip first copyright lines
        resultFile = codeLines[i].split(" ")[2]; // filename is a third parameter
      }
    }

    // if filename was identified the return the correct error message
    if (resultFile != null)
      errorMsg = errorMsg.split(lineItem).join(resultFile + " at line: " + (resultPos));

    // failed to identify the position in code, return message as is
    // without changes
    return errorMsg;
  }

  /**
   * Start session
   * @param {string} deviceCode
   * @param {string} agentCode
   * @param {string} modelId
   * @param {string} deviceId
   */
  _start(deviceCode, agentCode, modelId, deviceId) {

    this._buildAPIClient
      .createRevision(modelId, deviceCode, agentCode)

      .then((body) => {

        this.emit('message', {
          type: 'info',
          message: c.blue('Created revision: ') + body.revision.version
        });

        return this._buildAPIClient
          .restartDevice(deviceId)
          .then( /* device restarted */ () => {
            this._debug(c.blue('Device restarted'));
          });
      })

      .catch((error) => {
        this.emit('error', error);
      });
  }

  /**
   * Finish test session
   */
  _finish() {
    if (this.error) {
      this.emit('message', {
        type: 'info',
        message: c.red('Session ') + this.id + c.red(' failed')
      });
    } else {
      this.emit('message', {
        type: 'info',
        message: c.green('Session ') + this.id + c.green(' succeeded')
      });
    }

    this.emit('done');
  }


  /**
   * Handle log *event* (produced by LogParser)
   *
   * @param {{type, value}} log
   * @private
   */
  _handleLog(log, getErrorDetails) {

    switch (log.type) {

      case 'AGENT_RESTARTED':
        if (this.state === 'initialized') {
          // also serves as an indicator that current code actually started to run
          // and previous revision was replaced
          this.state = 'ready';
        }
        break;

      case 'DEVICE_CODE_SPACE_USAGE':

        if (this._deviceCodespaceUsage !== log.value) {

          this.emit('message', {
            type: 'info',
            message: c.blue('Device code space usage: ') + sprintf('%.1f%%', log.value)
          });

          this._deviceCodespaceUsage = log.value; // avoid duplicate messages
        }

        break;

      case 'DEVICE_OUT_OF_CODE_SPACE':
        this.emit('error', new Errors.DeviceError('Device is out of code space'));
        break;

      case 'DEVICE_OUT_OF_MEMORY':

        this.emit(
          this.state === 'started' ? 'error' : 'warning',
          new Errors.DeviceError('Device is out of memory')
        );

        break;

      case 'LASTEXITCODE':

        this.emit(
          this.state === 'started' ? 'error' : 'warning',
          new Errors.DeviceError('Device Error: ' + log.value)
        );

        break;

      case 'DEVICE_ERROR':
        var errorMessage = getErrorDetails ? getErrorDetails(log.value) : log.value;
        this.emit(
          this.state === 'started' ? 'error' : 'warning',
          new Errors.DeviceRuntimeError('Device Runtime Error: ' + errorMessage)
        );

        break;

      case 'AGENT_ERROR':
        var errorMessage = getErrorDetails ? getErrorDetails(log.value) : log.value;
        this.emit(
          this.state === 'started' ? 'error' : 'warning',
          new Errors.AgentRuntimeError('Agent Runtime Error: ' + errorMessage)
        );

        break;

      case 'DEVICE_CONNECTED':
        break;

      case 'DEVICE_DISCONNECTED':

        if (this.allowDisconnect) {
          this.emit('message', {
            type: 'info',
            message: c.blue('Disconnected. Allowed by config.')
          });

          break;
        }

        this.emit(
          this.state === 'started' ? 'error' : 'warning',
          new Errors.DeviceDisconnectedError()
        );

        break;

      case 'POWERSTATE':
        // ??? any actions needed?

        this.emit('message', {
          type: 'info',
          message: c.blue('Powerstate: ') + log.value
        });

        break;

      case 'FIRMWARE':
        // ??? any actions needed?

        this.emit('message', {
          type: 'info',
          message: c.blue('Firmware: ') + log.value
        });

        break;

      case 'IMPUNIT':

        if (log.value.session !== this.id) {
          // skip messages not from the current session
          // ??? should an error be thrown?
          break;
        }

        this.emit('testMessage');

        switch (log.value.type) {

          case 'SESSION_START':

            this.emit('start');

            if (this.state !== 'ready') {
              throw new Errors.TestStateError();
            }

            this.state = 'started';
            break;

          case 'TEST_START':

            if (this.state !== 'started') {
              throw new Errors.TestStateError();
            }

            // status message
            this.emit('message', {
              type: 'test',
              message: log.value.message
            });

            break;

          case 'TEST_FAIL':

            if (this.state !== 'started') {
              throw new Errors.TestStateError();
            }
            var errorMessage = getErrorDetails ? getErrorDetails(log.value.message) : log.value.message;
            this.emit('error', new Errors.TestMethodError(errorMessage));
            break;

          case 'SESSION_RESULT':

            this.emit('result');

            if (this.state !== 'started') {
              throw new Errors.TestStateError();
            }

            this.tests = log.value.message.tests;
            this.failures = log.value.message.failures;
            this.assertions = log.value.message.assertions;
            this.state = 'finished';

            const sessionMessage =
              `Tests: ${this.tests}, Assertions: ${this.assertions}, ` +
              `Failures: ${this.failures}`;

            if (this.failures) {

              this.emit('message', {
                type: 'test',
                message: c.red(sessionMessage)
              });

              this.emit('error', new Errors.SessionFailedError('Session failed'));

            } else {

              this.emit('message', {
                type: 'info',
                message: c.green(sessionMessage)
              });

            }

            this.stop = true;
            break;

          case 'TEST_OK':

            let message;

            if (typeof log.value.message === 'string') {
              message = log.value.message;
            } else {
              message = JSON.stringify(log.value.message);
            }

            this.emit('message', {
              type: 'test',
              message: null !== log.value.message ?
                (c.green('Success: ') + message) : c.green('Success')
            });

            break;

          case 'EXTERNAL_COMMAND':

            // run command

            this.emit('message', {
              type: 'info',
              message: c.blue('Running external command ') + log.value.message.command
            });

            let res;

            try {

              const env = JSON.parse(JSON.stringify(process.env));

              // remove blocked env vars
              if (this.externalCommandsBlockedEnvVars) {
                for (const blokedVarName of this.externalCommandsBlockedEnvVars) {
                  delete env[blokedVarName];
                }
              }

              res = syncExec(log.value.message.command, this.externalCommandsTimeout * 1000, {
                cwd: this.externalCommandsCwd,
                env
              });

              // debug command result
              this._debug(c.blue('External command STDOUT'), res.stdout);
              this._debug(c.blue('External command STDERR'), res.stderr);
              this._debug(c.blue('External command exit code'), res.satus);

              // output command STDOUT

              let out = res.stdout;
              out = res.stdout;

              out = out.toString().trim().split(/\n|\r\n/).map(v => '> ' + v).join('\n');

              this.emit('message', {
                type: 'externalCommandOutput',
                message: c.cyan(out)
              });

              // check exit code
              if (res.status !== 0) {
                throw new Errors.ExternalCommandExitCodeError(`External command failed with exit code ${res.status}`);
              }
            } catch (e) {
              if (e.message === 'Timeout') {
                throw new Errors.ExternalCommandTimeoutError();
              } else {
                throw e;
              }
            }

            break;

            // this.info() from test case
          case 'INFO':

            this.emit('message', {
              type: 'testInfo',
              message: c.cyan(JSON.stringify(log.value.message.message))
            });

            break;

          default:
            break;
        }

        break;

      default:

        this.emit('message', {
          type: 'info',
          message: c.blue('Message of type ') + log.value.type + c.blue(': ') + log.value.message
        });

        break;
    }
  }

  set allowDisconnect(value) {
    this._allowDisconnect = value;
  }

  get allowDisconnect() {
    return this._allowDisconnect;
  }

  get id() {
    return this._id;
  }

  set id(value) {
    this._id = value;
  }

  get state() {
    return this._state;
  }

  set state(value) {
    this._state = value;
  }

  get failures() {
    return this._failures || 0;
  }

  set failures(value) {
    this._failures = value;
  }

  get assertions() {
    return this._assertions || 0;
  }

  set assertions(value) {
    this._assertions = value;
  }

  get tests() {
    return this._tests || 0;
  }

  set tests(value) {
    this._tests = value;
  }

  get error() {
    return this._error;
  }

  set error(value) {
    this._error = value;
  }

  get buildAPIClient() {
    return this._buildAPIClient;
  }

  set buildAPIClient(value) {
    this._buildAPIClient = value;
  }

  get logParser() {
    return this._logParser;
  }

  set logParser(value) {
    this._logParser = value;
  }

  get stop() {
    return this._stop;
  }

  set stop(value) {

    // stop log parser
    if (this.logParser) {
      this.logParser.stop = !!value;
    }

    if (value != /* use weak compare to match null to booleans */ this._stop) {
      this._stop = !!value;

      // finish
      if (this._stop) {
        this._finish();
      }
    }

  }

  get externalCommandsTimeout() {
    return this._externalCommandsTimeout;
  }

  set externalCommandsTimeout(value) {
    this._externalCommandsTimeout = value;
  }

  get externalCommandsCwd() {
    return this._externalCommandsCwd;
  }

  set externalCommandsCwd(value) {
    this._externalCommandsCwd = value;
  }

  get externalCommandsBlockedEnvVars() {
    return this._externalCommandsBlockedEnvVars;
  }

  set externalCommandsBlockedEnvVars(value) {
    this._externalCommandsBlockedEnvVars = value;
  }
}

module.exports = Session;
module.exports.Errors = Errors;
