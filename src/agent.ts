// Define a custom tool as a TypeScript function
import { Agent, tool } from '@strands-agents/sdk'
import z from 'zod'
import { OllamaModel } from './ollama'

const letterCounter = tool({
  name: 'letter_counter',
  description: 'Count occurrences of a specific letter in a word. Performs case-insensitive matching.',
  // Zod schema for letter counter input validation
  inputSchema: z
    .object({
      word: z.string().describe('The input word to search in'),
      letter: z.string().describe('The specific letter to count'),
    })
    .refine((data) => data.letter.length === 1, {
      message: "The 'letter' parameter must be a single character",
    }),
  callback: (input) => {
    const { word, letter } = input

    // Convert both to lowercase for case-insensitive comparison
    const lowerWord = word.toLowerCase()
    const lowerLetter = letter.toLowerCase()

    // Count occurrences
    let count = 0
    for (const char of lowerWord) {
      if (char === lowerLetter) {
        count++
      }
    }

    // Return result as string (following the pattern of other tools in this project)
    return `The letter '${letter}' appears ${count} time(s) in '${word}'`
  },
})

// Create an agent with tools with our custom letterCounter tool
const agent = new Agent({
  model: new OllamaModel({modelId:'llama3.2'}),
  tools: [letterCounter],
})

// Ask the agent a question that uses the available tools
const message = `Tell me how many letter R's are in the word "strawberry" 🍓`
const result = await agent.invoke(message)
console.log(result.lastMessage)