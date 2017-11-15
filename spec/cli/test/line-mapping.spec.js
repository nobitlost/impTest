// MIT License
//
// Copyright 2017 Electric Imp
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

// Builder syntax tests

'use strict';

require('jasmine-expect');
const run = require('./run');

describe('TestCommand test server error scenario', () => {
  let commandOut = '',
    commandSuccess = true;

  beforeEach(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 100000;
  });

  it('should run files with agent and device test errors', (done) => {
    run({
      configPath:  '/fixtures/line-mapping/.imptest',
    }).then((res) => {
      commandSuccess = res.success;
      commandOut = res.out;
      done();
    });
  });

  it('should verify that all test are failed with correct filename', (done) => {
    expect(commandSuccess).toBe(false);
    expect(commandOut).not.toBeEmptyString();

    // All tests are failed as expected
    expect(commandOut).toMatch(/Testing failed\n/);

    // Promise.all failure - should contain wrong filename
    expect(commandOut).toMatch(/the index 'then' does not exist/);

    // division by zero (".../myDevice.class.nut" at line: 7)
    expect(commandOut).toMatch(/division by zero \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);

    // wrong number of parameters (".../myDevice.class.nut" at line: 11)
    expect(commandOut).toMatch(/wrong number of parameters \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);

    // float expected for the specified format (".../code-error.device.nut" at line: 33)
    expect(commandOut).toMatch(/float expected for the specified format \"[_\-.\/\w+]+\/code-error.device.nut\" at line: \d+/);

    // the index 'unknownField' does not exist (".../code-error.device.nut" at line: \d+)
    expect(commandOut).toMatch(/the index '\w+' does not exist \"[_\-.\/\w+]+\/code-error.device.nut\" at line: \d+/);

    // class instances do not support the new slot operator ("/Core.nut" at line: 16)
    expect(commandOut).toMatch(/class instances do not support the new slot operator \"[_\-.\/\w+]+\/Core.nut\" at line: \d+/);

    // AGENT TEST CHECKING
    // the index 'fieldDoesNotExists' does not exist ("/.../myAgent.class.nut" at line: 15)
    expect(commandOut).toMatch(/the index '\w+' does not exist \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);

    // Build time errors checking
    expect(commandOut).toMatch(/Build API error \"CompileFailed\"/);

    done();
  });

  it('should run files with agent and device test errors with remote agetn failure', (done) => {
    run({
      configPath:  '/fixtures/line-mapping/.imptest-remote',
    }).then((res) => {
      commandSuccess = res.success;
      commandOut = res.out;
      done();
    });
  });

  it('should verify that all test are failed with correct filename', (done) => {
    expect(commandSuccess).toBe(false);
    expect(commandOut).not.toBeEmptyString();

    // All tests are failed aas expected
    expect(commandOut).toMatch(/Testing failed\n/);

    // Check that agent code failed on testRemoteAgentExceptions
    // the index 'unknownField' does not exist
    // in unknow "/.../myAgent.class.nut" at line: 48
    expect(commandOut).toMatch(/the index '\w+' does not exist/);
    expect(commandOut).toMatch(/in unknown \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);

    //Check that agent stack is available:
    expect(commandOut).toMatch(/wrong number of parameters/);
    expect(commandOut).toMatch(/in f \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from f1 \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from f2 \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from unknown \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);

    // Note: it is not possible to make two test for remote device failure
    //       as it is done above for remote agent failure
    //       because when the device code throw an exception then it is not possible
    //       to get any log-failures anymore
    // As a result we have only one test for the device remote failure:

    //Check that the device stack is available:
    expect(commandOut).toMatch(/wrong number of parameters/);
    expect(commandOut).toMatch(/in d \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from d1 \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from d2 \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from unknown \"[_\-.\/\w+]+\/myDevice.class.nut\" at line: \d+/);

    done();
  });

  it('should run files with agent and device test errors with detailed stack', (done) => {
    run({
      configPath:  '/fixtures/line-mapping/.imptest-stack',
    }).then((res) => {
      commandSuccess = res.success;
      commandOut = res.out;
      done();
    });
  });

  it('should verify that all test are failed with correct stack and filenames', (done) => {
    expect(commandSuccess).toBe(false);
    expect(commandOut).not.toBeEmptyString();

    // All tests are failed aas expected
    expect(commandOut).toMatch(/Testing failed\n/);

    //Check that agent stack is available:
    expect(commandOut).toMatch(/wrong number of parameters/);
    expect(commandOut).toMatch(/in f \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from f1 \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from f2 \"[_\-.\/\w+]+\/myAgent.class.nut\" at line: \d+/);
    expect(commandOut).toMatch(/from unknown \"[_\-.\/\w+]+\/code-error-with-stack.agent.nut\" at line: \d+/);

    done();
  });
});
