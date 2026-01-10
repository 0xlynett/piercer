import { Command, Args } from "@oclif/core";
import { downloadModelToAgent } from "../../utils/api.js";

export default class AgentsDownload extends Command {
  static description = "Download a model to an agent";
  static args = {
    agentId: Args.string({ description: "Agent ID", required: true }),
    modelUrl: Args.string({ description: "URL of the model to download", required: true }),
    filename: Args.string({ description: "Filename to save the model as", required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(AgentsDownload);
    try {
      const result = await downloadModelToAgent(args.agentId, args.modelUrl, args.filename);
      this.log("Download started:");
      this.log(JSON.stringify(result, null, 2));
    } catch (error) {
      this.error(`Failed to download model: ${error}`);
    }
  }
}
