import { Command, Args } from "@oclif/core";
import { deleteMapping } from "../../utils/api.js";

export default class MappingsDelete extends Command {
  static description = "Delete a model mapping";
  static args = {
    publicName: Args.string({ description: "Public name of the mapping to delete", required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MappingsDelete);
    try {
      await deleteMapping(args.publicName);
      this.log(`Mapping "${args.publicName}" deleted.`);
    } catch (error) {
      this.error(`Failed to delete mapping: ${error}`);
    }
  }
}
