function d(x) {
    d();
}

function d1(y) {
    d(y);
}

function d2(z) {
    d1(z);
}


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

// Test remote device code failure
agent.on("devicestack", function(payload) {
    d2(2); // should get stack at this place
}.bindenv(this));
