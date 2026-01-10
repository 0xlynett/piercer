import { Command, Args } from "@oclif/core";
import { addMapping } from "../../utils/api.js";

export default class MappingsAdd extends Command {
  static description = "Add a new model mapping";
  static args = {
    publicName: Args.string({ description: "Public name for the model", required: true }),
    filename: Args.string({ description: "Filename of the model", required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(MappingsAdd);
    try {
      const result = await addMapping(args.publicName, args.filename);
      this.log("Mapping added:");
      this.log(JSON.stringify(result, null, 2));
    } catch (error) {
      this.error(`Failed to add mapping: ${error}`);
    }
  }
}
