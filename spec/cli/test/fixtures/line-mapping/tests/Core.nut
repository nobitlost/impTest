

class CoreTestCase  extends ImpTestCase {


  function fieldDoesNotExistTest() {
      makeTest = "Error";
  }

  function unhandledThrowTest() {
      throw "Unhandled exception";
  }

  // Throw: Class instances do not support the new slot operator
  function throwClassExceptionTest() {
      function f(x) {
        f();
      }
      f(1);
  }

  // Throw: Division by zero
  function devisionByZeroTest() {
      DeviceCodeErrors().devisionByZero();
  }
}
