# coding-agent

A customized coding agent built on the Strands SDK and Ollama.

## 🛠 Prerequisites
1. Node.js: v20.x or higher.

2. Ollama: Installed and running ([Download here](https://ollama.com/)).

```
ollama pull <modelId>
```

## 🏃 Run the Agent

1. Edit [src/agent.ts](src/agent.ts) to pass in the `<modelId>` pulled above when instantiating the agent

2. `npx tsx src/agent.ts`