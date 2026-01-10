import { Command } from "@oclif/core";
import { getAgents } from "../../utils/api.js";

export default class AgentsList extends Command {
  static description = "List all connected agents";

  async run(): Promise<void> {
    try {
      const agents = await getAgents();
      this.log(JSON.stringify(agents, null, 2));
    } catch (error) {
      this.error(`Failed to fetch agents: ${error}`);
    }
  }
}
