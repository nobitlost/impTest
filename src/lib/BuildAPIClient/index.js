'use strict';

const c = require('colors');
const request = require('request');
const promiseWhile = require('../utils/promiseWhile');

/**
 * Electric Imp Build API client.
 * Will be published as package eventually.
 *
 * @see https://electricimp.com/docs/buildapi/
 */
class BuildAPIClient {

  constructor() {
    this.__debug = false;
    this._apiKey = null;
    this._apiEndpoint = 'https://build.electricimp.com/v4';
  }

  /**
   * Make Build API request
   *
   * @param {string} method
   * @param {string} path
   * @param {string|{}} query
   * @param {{}} headers
   * @returns {Promise}
   */
  request(method, path, query, headers) {
    return new Promise((resolve, reject) => {

      method = method.toUpperCase();
      query = query || '';
      headers = headers || {};

      const options = {
        method,
        json: true,
        url: this.apiEndpoint + path,
        headers: {
          'User-agent': 'impTest',
          'Content-type': 'application/json',
          'Authorization': 'Basic ' + new Buffer(this.apiKey || '').toString('base64')
        }
      };

      // use query as body on methods other than GET
      if (query && method === 'GET') {
        options.qs = query;
      } else if (query) {
        options.body = query;
      }

      // add headers passed
      Object.assign(options.headers, headers);

      /* [debug] */
      this._debug(c.blue('Doing the request with options:'), options);

      // do request to build api
      request(options, (error, response, result) => {

        // debug output
        response && this._debug(c.blue('Response code:'), response.statusCode);
        result && this._debug(c.blue('Response:'), result);

        // handle result

        if (error) {

          /* [debug] */
          this._debug(c.red('Request error:'), error);

          // we're completely screwed
          // error is produced by request libabry
          reject(error);

        } else if (!result || !result.success) {

          let err;

          if (result && result.error) {
            // we have an error message from web server {error: {code, message_short, message_full}} response
            err = new Error('Build API error "' + result.error.code + '": ' + result.error.message_short);
          } else if (result && result.code && result.message) {
            // we have bad HTTP status code and {code, message} response
            err = new Error('Build API error "' + result.code + '": ' + result.message);
          } else {
            // we have nothing but it's bad
            err = new Error('Build API error HTTP/' + response.statusCode);
          }

          /* [debug] */
          this._debug(c.red(err.message));

          reject(err);

          // todo: handle rate limit hit
          // todo: produce custom error types

        } else {
          // we're cool
          resolve(result);
        }

      });
    });
  }

  /**
   * Get list of devices
   *
   * @see https://electricimp.com/docs/buildapi/device/list/
   * @param {string} [name] - List devices whose name contains the supplied string fragment (case-insensitive)
   * @param {string} [deviceId] - List the device whose device ID exactly matches the supplied string
   * @param {string} [modelId] - List devices whose model ID exactly matches the supplied string
   * @return {Promise}
   */
  getDevices(name, deviceId, modelId) {
    return this.request('GET', '/devices', {
      device_id: deviceId,
      model_id: modelId,
      name: name
    });
  }

  /**
   * Get device info
   *
   * @see https://electricimp.com/docs/buildapi/device/get/
   * @param {string} deviceId
   * @return {Promise}
   */
  getDevice(deviceId) {
    return this.request('GET', '/devices/' + deviceId);
  }

  /**
   * Get models
   *
   * @see https://electricimp.com/docs/buildapi/model/list/
   * @param {string} [name] - List models whose name contains the supplied string fragment (case-insensitive)
   * @return {Promise}
   */
  getModels(name) {
    return this.request('GET', '/models', {
      name: name
    });
  }

  /**
   * Get model
   *
   * @see https://electricimp.com/docs/buildapi/model/get/
   * @param {string} modelId
   * @return {Promise}
   */
  getModel(modelId) {
    return this.request('GET', '/models/' + modelId);
  }

  /**
   * Upload a new code revision
   * @see https://electricimp.com/docs/buildapi/coderev/upload/
   *
   * @param {string} modelId
   * @param {string} [deviceCode=undefined]
   * @param {string} [agentCode=undefined]
   * @param {string} [releaseNotes=undefined]
   * @returns {Promise}
   */
  createRevision(modelId, deviceCode, agentCode, releaseNotes) {
    return this.request('POST', `/models/${modelId}/revisions`, {
      device_code: deviceCode,
      agent_code: agentCode,
      release_notes: releaseNotes
    });
  };

  /**
   * Restart model
   * @see https://electricimp.com/docs/buildapi/model/restart/
   *
   * @param {string} modelId
   * @returns {Promise}
   */
  restartModel(modelId) {
    return this.request('POST', `/models/${modelId}/restart`);
  }

  /**
   * Get device logs
   * @see https://electricimp.com/docs/buildapi/logentry/list/
   * @see https://electricimp.com/docs/buildapi/logentry/
   *
   * @param deviceId
   * @param {Date|string} [since=undefined] - start date (string in ISO 8601 format or Date instance)
   * @returns {Promise}
   */
  getDeviceLogs(deviceId, since) {
    // convert since to ISO 8601 format
    since && (since instanceof Date) && (since = since.toISOString());
    return this.request('GET', `/devices/${deviceId}/logs`, {since});
  }

  /**
   *
   * @param deviceID
   * @param {function(data)} [callback] Data callback. If it returns false, streaming stops.
   *  Callback with no data means we've obtained the poll url.
   */
  streamDeviceLogs(deviceId, callback) {
    return new Promise((resolve, reject) => {

      this.getDeviceLogs(deviceId, '3000-01-01T00:00:00.000+00:00' /* just get poll url */)
        .then((data) => {

          let stop = false;

          let pollUrl = data.poll_url;
          pollUrl = pollUrl.replace(/^\/v\d+/, ''); // remove version prefix

          // we've obtained the poll url
          stop = !callback(null);

          promiseWhile(
            () => !stop,
            () => {
              return new Promise((resolve, reject) => {
                this.request('GET', pollUrl)
                  .then((data) => {
                    stop = !callback(data);
                    resolve(); // next stream request
                  })
                  .catch((error) => {
                    if (error.message.indexOf('InvalidLogToken') !== -1 /* we need to refresh token */) {
                      stop = true;
                      resolve(this.streamDeviceLogs(deviceId, callback));
                    } else if (error.message.indexOf('HTTP/504') !== -1 /* timeout error */) {
                      resolve();
                    } else {
                      reject(error);
                    }
                  });
              });
            }
          ).then(resolve, reject);

        })
        .catch(reject);
    });
  }

  /**
   * Debug print
   * @param {*} ...objects
   * @protected
   */
  _debug() {
    if (this.debug) {
      const args = Array.prototype.slice.call(arguments);
      args.unshift(c.green('[debug:' + this.constructor.name + ']'));
      console.log.apply(this, args);
    }
  }

  set apiKey(value) {
    this._apiKey = value;
  }

  get apiKey() {
    return this._apiKey;
  }

  get debug() {
    return this.__debug;
  }

  set debug(value) {
    this.__debug = value;
  }

  get apiEndpoint() {
    return this._apiEndpoint;
  }

  set apiEndpoint(value) {
    this._apiEndpoint = value;
  }
}

module.exports = BuildAPIClient;
