import { Command } from "@oclif/core";
import { getMappings } from "../../utils/api.js";

export default class MappingsList extends Command {
  static description = "List all model mappings";

  async run(): Promise<void> {
    try {
      const mappings = await getMappings();
      this.log(JSON.stringify(mappings, null, 2));
    } catch (error) {
      this.error(`Failed to fetch mappings: ${error}`);
    }
  }
}
