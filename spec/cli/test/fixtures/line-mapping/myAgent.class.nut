class AgentCodeError {
  // NOTE: imptest should fail on
  //       this function call
  function checkFieldDoesNotExist() {
      this.fieldDoesNotExists = true;
  }
}
