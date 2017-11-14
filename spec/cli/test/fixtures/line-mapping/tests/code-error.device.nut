@include __PATH__+"/./Core.nut"

class CodeErrorTestCase extends CoreTestCase {

  // This test show throw an exception
  // in scope of the test class
  function testPlainExceptionThrow() {
      unknownField = true;
      assertTrue(true, "Should not get the line executed");
  }

  // This test show throw an exception
  // in base test class CoreTestCase
  function testBaseClassExceptionThrow() {
      throwClassExceptionTest();
  }

  // This test show throw an exception
  // in the device code
  function testDeviceClassExceptionThrow() {
      DeviceCodeErrors().throwWrongNumberOfParameters();
  }

  // This test show throw an exception
  // in the device code through the base class
  function testDeviceClassExceptionThrowViaBaseClass() {
      devisionByZeroTest();
  }

  // This test show check an exception handling
  // in scope of promise based test
  function testPromiseExceptionLog() {
      return Promise(function(resolve, reject) {
          local a = format("%.4e", "TEXT");
      });
  }

  function testInRequiredFailure() {
      local result = Promise.all([Promise(function(resolve, reject) {
          imp.wakeup(1, function() {
              resolve();
          }.bindenv(this));
      }), 1234]);
      return result;
  }
}
