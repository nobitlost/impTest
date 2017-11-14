class DeviceCodeErrors {
  function sendError() {
      server.error("Send server error");
  }

  function devisionByZero() {
    local x = 10 / 0;
  }

  function throwWrongNumberOfParameters() {
      _wrongNumberOfParameters();
  }

  // Helper method to throw exception
  function _wrongNumberOfParameters(x, y, z) {

  }
}
