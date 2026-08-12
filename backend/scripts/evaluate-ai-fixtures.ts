import { evaluateAllDocumentModels } from '../src/evals/aiDocumentEvaluation';

console.log(JSON.stringify({ generated_at: new Date().toISOString(), reports: evaluateAllDocumentModels() }, null, 2));
