# Development

Piercer is meant to operate in the following environments:
- CPU only
- NVIDIA GPU

However, not all development systems have GPUs. As such, if you are developing on a separate machine from the machine on which your development agent is running, Piercer comes with a syncing tool that automatically syncs any changes made to the remote, which can be used with `bun sync`.