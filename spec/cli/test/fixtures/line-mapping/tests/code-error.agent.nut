
class AgentTestCase extends ImpTestCase {
  function testAgentServerError() {
      AgentCodeError().checkFieldDoesNotExist();
      assertTrue(true, "if you see this line then something goes wrong");
  }
}
