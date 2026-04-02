"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMHelper = void 0;
const genai_1 = require("@google/genai");
const fs_1 = __importDefault(require("fs"));
class LLMHelper {
    ai;
    modelName;
    //stage 1
    //   private readonly systemPrompt = `You are Wingman AI, a helpful, proactive assistant for any kind of problem or situation. For any user input, analyze the situation, provide a clear problem statement, relevant context, and suggest several possible responses or actions the user could take next. Always explain your reasoning. Present your suggestions as a list of options or next steps.`
    systemPrompt = `You are an expert programmer. Your task is to analyze the user’s request which may include images of code or problems, and provide a direct code based solution. If the user provides code identify any errors and provide a corrected, complete version. If the user provides a problem description, write the code to solve it. Make sure to provide the most optimal solution.`;
    constructor(apiKey) {
        const apiVersion = process.env.GEMINI_API_VERSION || "v1beta";
        this.ai = new genai_1.GoogleGenAI({ apiKey, apiVersion });
        this.modelName = process.env.GEMINI_PRO_MODEL || "";
    }
    setModel(modelName) {
        console.log("LLMHelper: setting model to", modelName);
        this.modelName = modelName;
    }
    async fileToGenerativePart(imagePath) {
        const imageData = await fs_1.default.promises.readFile(imagePath);
        const mimeType = imagePath.endsWith(".png")
            ? "image/png"
            : imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg")
                ? "image/jpeg"
                : "image/png"; // Fallback to png
        return {
            inlineData: {
                data: imageData.toString("base64"),
                mimeType
            }
        };
    }
    getTextFromResponse(response) {
        if (!response)
            return "";
        if (typeof response.text === "string")
            return response.text;
        if (typeof response.text === "function")
            return response.text();
        return "";
    }
    cleanJsonResponse(text) {
        // Remove markdown code block syntax if present
        text = text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '');
        // Remove any leading/trailing whitespace
        text = text.trim();
        return text;
    }
    async extractProblemFromImages(imagePaths) {
        try {
            const imageParts = await Promise.all(imagePaths.map(path => this.fileToGenerativePart(path)));
            const prompt = `You are an expert AI assistant. Your task is to analyze the user's request, which may include images. First, classify the request as either a "coding" problem or a "general" question.

If it's a "coding" problem, provide a direct code-based solution. If the user provides code, identify any errors and provide a corrected, complete version. If the user provides a problem description, write the code to solve it.

If it's a "general" question (like a multiple-choice question or a general knowledge query), provide a direct, concise answer.

Please provide the output in the following JSON format:
{
  "type": "coding | general",
  "response": {
    // If type is "coding", this object should contain the following fields:
    "code": "The complete, runnable, comment-free code solution here.",
    "explanation": "A brief, high-level explanation of the code solution.",
    "time_complexity": "The time complexity of the solution.",
    "space_complexity": "The space complexity of the solution.",
    // If type is "general", this object should contain the following field:
    "answer": "A direct and concise answer to the user's question."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.
CRITICAL: The 'code' field must contain only code. It must not contain any comments, explanations, or any text that is not valid code.`;
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }, ...imageParts]
                    }
                ]
            });
            const text = this.cleanJsonResponse(this.getTextFromResponse(result));
            return JSON.parse(text);
        }
        catch (error) {
            console.error("Error extracting problem from images:", error);
            throw error;
        }
    }
    async generateSolution(problemInfo) {
        const prompt = `You are an expert programmer. Your task is to analyze the user’s request which may include images of code or problems, and provide a direct code based solution. If the user provides code identify any errors and provide a corrected, complete version. If the user provides a problem description, write the code to solve it. Make sure to provide the most optimal solution.
    
Given this problem or situation:\n${JSON.stringify(problemInfo, null, 2)}

Please provide your response in the following JSON format:
{
  "solution": {
    "code": "The code or main answer here. This should be the complete, runnable code solution. Do not include any comments in the code.",
    "problem_statement": "Restate the problem or situation.",
    "context": "Relevant background/context.",
    "suggested_responses": ["Provide a brief, high-level explanation of the code solution.", "If there are alternative solutions, mention one here.", "Explain any key assumptions made."],
    "reasoning": "Explanation of why these suggestions are appropriate.",
    "time_complexity": "The time complexity of the solution.",
    "space_complexity": "The space complexity of the solution."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.`;
        console.log("[LLMHelper] Calling Gemini LLM for solution...");
        try {
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: prompt
            });
            console.log("[LLMHelper] Gemini LLM returned result.");
            const text = this.cleanJsonResponse(this.getTextFromResponse(result));
            const parsed = JSON.parse(text);
            console.log("[LLMHelper] Parsed LLM response:", parsed);
            return parsed;
        }
        catch (error) {
            console.error("[LLMHelper] Error in generateSolution:", error);
            throw error;
        }
    }
    async debugSolutionWithImages(problemInfo, currentCode, debugImagePaths) {
        try {
            const imageParts = await Promise.all(debugImagePaths.map(path => this.fileToGenerativePart(path)));
            const prompt = `You are an expert programmer. Your task is to debug the provided code based on an image of an error.
      
Given:
1. The original problem description: ${problemInfo.response.explanation}
2. The current, incorrect code: 
\
${currentCode}
\
3. The debug information in the provided images.

Please analyze the error in the image and provide a corrected, complete, and runnable version of the code.

Please provide the output in the following JSON format:
{
  "type": "coding",
  "response": {
    "code": "The corrected, runnable, comment-free code solution here. Do not include any comments in the code. This is a strict requirement.",
    "explanation": "A brief, high-level explanation of the fix.",
    "time_complexity": "The time complexity of the corrected solution.",
    "space_complexity": "The space complexity of the corrected solution."
  }
}
Important: Return ONLY the JSON object, without any markdown formatting or code blocks.
CRITICAL: The 'code' field must contain only code. It must not contain any comments, explanations, or any text that is not valid code.`;
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }, ...imageParts]
                    }
                ]
            });
            const text = this.cleanJsonResponse(this.getTextFromResponse(result));
            const parsed = JSON.parse(text);
            console.log("[LLMHelper] Parsed debug LLM response:", parsed);
            return parsed;
        }
        catch (error) {
            console.error("Error debugging solution with images:", error);
            throw error;
        }
    }
    async analyzeAudioFile(audioPath) {
        try {
            const audioData = await fs_1.default.promises.readFile(audioPath);
            const audioPart = {
                inlineData: {
                    data: audioData.toString("base64"),
                    mimeType: "audio/mp3"
                }
            };
            const prompt = `${this.systemPrompt}\n\nAnswer the question asked in this audio in a short, concise answer. Answer the question as how the user should answer if they're in an interview. Do not return a structured JSON object, just answer naturally as you would to a user.`;
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }, audioPart]
                    }
                ]
            });
            const text = this.getTextFromResponse(result);
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing audio file:", error);
            throw error;
        }
    }
    async analyzeAudioFromBase64(data, mimeType) {
        try {
            const audioPart = {
                inlineData: {
                    data,
                    mimeType
                }
            };
            const prompt = `${this.systemPrompt}\n\nAnswer the question asked in this audio in a short, concise answer. Answer the question as how the user should answer if they're in an interview. Do not return a structured JSON object, just answer naturally as you would to a user.`;
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }, audioPart]
                    }
                ]
            });
            const text = this.getTextFromResponse(result);
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing audio from base64:", error);
            throw error;
        }
    }
    async analyzeImageFile(imagePath) {
        try {
            const imageData = await fs_1.default.promises.readFile(imagePath);
            const imagePart = {
                inlineData: {
                    data: imageData.toString("base64"),
                    mimeType: "image/png"
                }
            };
            const prompt = `${this.systemPrompt}\n\nDescribe the content of this image in a short, concise answer. In addition to your main answer, suggest several possible actions or responses the user could take next based on the image. Do not return a structured JSON object, just answer naturally as you would to a user. Be concise and brief.`;
            const result = await this.ai.models.generateContent({
                model: this.modelName,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }, imagePart]
                    }
                ]
            });
            const text = this.getTextFromResponse(result);
            return { text, timestamp: Date.now() };
        }
        catch (error) {
            console.error("Error analyzing image file:", error);
            throw error;
        }
    }
}
exports.LLMHelper = LLMHelper;
//# sourceMappingURL=LLMHelper.js.map