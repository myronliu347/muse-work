import { describe, expect, it } from "vitest";
import { validateToolInput } from "../../src/tools/inputValidation.js";
import { askUserQuestionTool } from "../../src/tools/askUserQuestion.js";
import { taskUpdateTool } from "../../src/tools/taskManagementTools.js";

const askSchema = askUserQuestionTool.config.function.parameters;

describe("validateToolInput", () => {
  it("names a missing taskId instead of letting the tool invent one", () => {
    const message = validateToolInput(
      "TaskUpdate",
      taskUpdateTool.config.function.parameters,
      { id: "1" },
    );
    expect(message).toContain("The required parameter `taskId` is missing");
    expect(message).toContain("An unexpected parameter `id` was provided");
  });

  it("reaches AskUserQuestion option labels seven levels down", () => {
    const missing = validateToolInput("AskUserQuestion", askSchema, {
      questions: [
        {
          question: "Which?",
          header: "Pick",
          options: [{ label: "A", description: "a" }, { description: "b" }],
        },
      ],
    });
    expect(missing).toContain(
      "The required parameter `questions[0].options[1].label` is missing",
    );

    const wrongType = validateToolInput("AskUserQuestion", askSchema, {
      questions: [
        {
          question: "Which?",
          header: "Pick",
          options: [
            { label: "A", description: "a" },
            { label: 42, description: "b" },
          ],
        },
      ],
    });
    expect(wrongType).toContain(
      "The parameter `questions[0].options[1].label` type is expected as `string` but provided as `integer`",
    );

    const empty = validateToolInput("AskUserQuestion", askSchema, {
      questions: [
        {
          question: "Which?",
          header: "Pick",
          options: [
            { label: "A", description: "a" },
            { label: "", description: "b" },
          ],
        },
      ],
    });
    expect(empty).toBeNull();
  });
});
