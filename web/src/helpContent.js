// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: "An AI agent on AWS Bedrock AgentCore Runtime whose identity comes from PingOne, shown in mock only: the M2M flow (the agent's own token), the USER_FEDERATION flow (3LO: a real human login through the agent), and downstream on-behalf-of delegation. Everything here is simulated — nothing calls a real AgentCore account, PingOne environment, AWS API or tenant, and nothing leaves your machine. Where a shape comes from a real build we name the source; everything else is labelled lab-invented or lab reading."
  },
  {
    heading: "Measured vs UNVERIFIED",
    body: "A few things were measured on real builds and are labelled as such (for example: with oauth2_flow=\"M2M\" the AgentCore call returns accessToken directly, verified on bedrock-agentcore SDK 1.21.0; act must be an object such as {\"sub\": \"...\"}, verified live 2026-10-26). The claim rule and the order of the six checks are the lab's own model of a downstream policy — inferred, not observed on a real tenant. Real mode, when configured, mints a genuine short-lived PingOne token through AWS AgentCore Identity; the scenario gate itself stays the mock model. Nothing on this page is a statement about product defaults, detection quality or licensing."
  },
  {
    heading: "How to use the page",
    body: [
      "The nav tabs are: \"M2M gate\", \"USER_FEDERATION (3LO)\", \"On-behalf-of\", \"Real\", \"Diagram\", \"Talk track\". Each tab shows a scenario list; pick one and press its Run control to see the checks pass or fail and why.",
      "In the header: the Mock/Real mode toggle, the vertical picker (e.g. airlines), the theme and font-size menus, \"Presenter (P)\" (the P key also toggles it), the talk-track button, Reset, and Help.",
      "The banner under the header always names the current mode. On the On-behalf-of tab a second release banner appears on top of it."
    ]
  },
  {
    heading: "Mode honesty",
    body: "Mock mode (the default) simulates the token, the claims evaluation and every check inside this app process. Real mode, once configured, uses a real PingOne token on the Real tab only — the scenario gate is still the mock model. If Real is not configured the toggle explains why and stays on Mock."
  },
  {
    heading: "Reset and privacy",
    body: "Reset clears your workspace's evaluations, restores the modelled gateway, and puts the diagram boxes back. Your typed text and runs stay in this browser's workspace; nothing is sent anywhere the banner does not name."
  }
];
