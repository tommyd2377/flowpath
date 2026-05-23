import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_OPENAI_MODEL,
  estimateModelCostDollars,
  getModelForRole,
  getModelRoutingConfig,
} from "./model-routing";

test("model routing falls back from role env to OPENAI_MODEL to default", () => {
  const priorBase = process.env.OPENAI_MODEL;
  const priorClassifier = process.env.OPENAI_CLASSIFIER_MODEL;
  const priorGenerator = process.env.OPENAI_GENERATOR_MODEL;
  try {
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_CLASSIFIER_MODEL;
    delete process.env.OPENAI_GENERATOR_MODEL;
    assert.equal(getModelForRole("classifier_model"), DEFAULT_OPENAI_MODEL);

    process.env.OPENAI_MODEL = "base-test-model";
    assert.equal(getModelForRole("generator_model"), "base-test-model");

    process.env.OPENAI_CLASSIFIER_MODEL = "cheap-classifier";
    assert.equal(getModelForRole("classifier_model"), "cheap-classifier");
    assert.equal(getModelRoutingConfig().generator_model, "base-test-model");
  } finally {
    if (priorBase === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = priorBase;
    if (priorClassifier === undefined) delete process.env.OPENAI_CLASSIFIER_MODEL;
    else process.env.OPENAI_CLASSIFIER_MODEL = priorClassifier;
    if (priorGenerator === undefined) delete process.env.OPENAI_GENERATOR_MODEL;
    else process.env.OPENAI_GENERATOR_MODEL = priorGenerator;
  }
});

test("model cost estimate is optional and stage-based", () => {
  const prior = process.env.OPENAI_MODEL_PRICING_JSON;
  try {
    process.env.OPENAI_MODEL_PRICING_JSON = JSON.stringify({
      "test-model": { input_per_1m: 1, output_per_1m: 2 },
    });
    assert.equal(
      estimateModelCostDollars({
        generator: {
          model: "test-model",
          inputTokens: 1_000,
          outputTokens: 2_000,
        },
      }),
      0.005,
    );

    delete process.env.OPENAI_MODEL_PRICING_JSON;
    assert.equal(
      estimateModelCostDollars({
        generator: { model: "test-model", inputTokens: 1, outputTokens: 1 },
      }),
      null,
    );
  } finally {
    if (prior === undefined) delete process.env.OPENAI_MODEL_PRICING_JSON;
    else process.env.OPENAI_MODEL_PRICING_JSON = prior;
  }
});
