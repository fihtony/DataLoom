/**
 * Three-Phase Database Analysis Prompts
 *
 * Phase 1: Table Structure Analysis (compact, fast)
 * Phase 2: Column Explanations (focused on columns only)
 * Phase 3: SQL Examples and Final Merge (focused on queries)
 *
 * This approach avoids large prompts that cause CopilotBridge timeouts
 */

// =============================================================================
// PHASE 1: Table Structure Analysis
// =============================================================================

/**
 * Phase 1 (With Schema) - Table Structure Analysis
 * Focus: table names, basic column info, relationships, data types
 */
export const DATABASE_PHASE1_WITH_SCHEMA_PROMPT = `You are a database schema analyst. Analyze the database schema and generate a basic knowledge base focused on table structure.

IMPORTANT: Consider the EXISTING KNOWLEDGE BASE provided below. This contains manually curated explanations and important notes about the tables. You MUST respect and preserve these explanations - they represent business requirements and constraints that override generic interpretations.

EXISTING KNOWLEDGE BASE (if any):
[EXISTING_KB_PLACEHOLDER]

USER NOTES (if any):
[USER_INPUT_PLACEHOLDER]

UPLOADED DOCUMENTS (if any):
[UPLOADED_FILES_PLACEHOLDER]

TASK: For each table, identify:
1. Table purpose (brief, 1-2 sentences) - USE existing explanations if available
2. Column names and data types
3. Primary/foreign keys
4. Basic relationships

OUTPUT: Return ONLY valid JSON:
{
  "tableExplanations": [
    {
      "schema_name": "schema_or_null",
      "table_name": "table_name",
      "explanation": "Brief description",
      "business_purpose": "One-line purpose",
      "keywords": [],
      "columns": [
        {
          "column_name": "col_name",
          "explanation": "What it stores",
          "data_type": "integer|text|boolean|double|json|binary|date|timestamp|uuid|decimal|varchar|char",
          "sensitivity_level": "public"
        }
      ]
    }
  ],
  "sqlExamples": []
}

CRITICAL: 
1. Always specify data_type for every column
2. PRESERVE existing explanations from the knowledge base - they contain important business rules`;

/**
 * Phase 1 (No Schema) - Table Structure Analysis
 */
export const DATABASE_PHASE1_NO_SCHEMA_PROMPT = `You are a database schema analyst. Analyze the database schema and generate a basic knowledge base focused on table structure.

IMPORTANT: Consider the EXISTING KNOWLEDGE BASE provided below. This contains manually curated explanations and important notes about the tables. You MUST respect and preserve these explanations - they represent business requirements and constraints that override generic interpretations.

EXISTING KNOWLEDGE BASE (if any):
[EXISTING_KB_PLACEHOLDER]

USER NOTES (if any):
[USER_INPUT_PLACEHOLDER]

UPLOADED DOCUMENTS (if any):
[UPLOADED_FILES_PLACEHOLDER]

TASK: For each table, identify:
1. Table purpose (brief, 1-2 sentences) - USE existing explanations if available
2. Column names and data types
3. Primary/foreign keys
4. Basic relationships

OUTPUT: Return ONLY valid JSON:
{
  "tableExplanations": [
    {
      "table_name": "table_name",
      "explanation": "Brief description",
      "business_purpose": "One-line purpose",
      "keywords": [],
      "columns": [
        {
          "column_name": "col_name",
          "explanation": "What it stores",
          "data_type": "integer|text|boolean|double|json|binary|date|timestamp|uuid|decimal|varchar|char",
          "sensitivity_level": "public"
        }
      ]
    }
  ],
  "sqlExamples": []
}

CRITICAL: 
1. Always specify data_type for every column
2. PRESERVE existing explanations from the knowledge base - they contain important business rules`;

// =============================================================================
// PHASE 2: Column Explanations
// =============================================================================

/**
 * Phase 2 (With Schema) - Column Explanations
 * Focus: detailed column documentation, synonyms, sample values, sensitivity
 */
export const DATABASE_PHASE2_WITH_SCHEMA_PROMPT = `You are a database schema analyst. Enhance column documentation with detailed business context.

TASK: For each column, add:
1. Detailed explanation (2-3 sentences)
2. Business meaning and usage
3. Synonyms and alternative names
4. Sensitivity level
5. Sample values

PHASE 1 STRUCTURE (preserve table/column names and data_types):
[PHASE1_KB_PLACEHOLDER]

DATABASE SCHEMA:
[SCHEMA_PLACEHOLDER]

OUTPUT: Return ONLY valid JSON - preserve Phase 1 structure and ADD:
{
  "tableExplanations": [
    {
      "schema_name": "[FROM PHASE1]",
      "table_name": "[FROM PHASE1]",
      "explanation": "[FROM PHASE1]",
      "business_purpose": "[FROM PHASE1]",
      "keywords": [],
      "columns": [
        {
          "column_name": "[FROM PHASE1]",
          "explanation": "2-3 sentence detailed explanation",
          "business_meaning": "How column is used in business",
          "data_type": "[FROM PHASE1 - MUST PRESERVE]",
          "sensitivity_level": "public|internal|confidential",
          "synonyms": ["alternative_name"],
          "sample_values": ["value1", "value2"]
        }
      ]
    }
  ],
  "sqlExamples": []
}

CRITICAL:
1. PRESERVE all Phase 1 data (table names, data_types, structure)
2. ONLY ADD missing fields (explanation, business_meaning, sensitivity_level, synonyms, sample_values)
3. Return ONLY JSON`;

/**
 * Phase 2 (No Schema) - Column Explanations
 */
export const DATABASE_PHASE2_NO_SCHEMA_PROMPT = `You are a database schema analyst. Enhance column documentation with detailed business context.

TASK: For each column, add:
1. Detailed explanation (2-3 sentences)
2. Business meaning and usage
3. Synonyms and alternative names
4. Sensitivity level
5. Sample values

PHASE 1 STRUCTURE (preserve table/column names and data_types):
[PHASE1_KB_PLACEHOLDER]

DATABASE SCHEMA:
[SCHEMA_PLACEHOLDER]

OUTPUT: Return ONLY valid JSON - preserve Phase 1 structure and ADD:
{
  "tableExplanations": [
    {
      "table_name": "[FROM PHASE1]",
      "explanation": "[FROM PHASE1]",
      "business_purpose": "[FROM PHASE1]",
      "keywords": [],
      "columns": [
        {
          "column_name": "[FROM PHASE1]",
          "explanation": "2-3 sentence detailed explanation",
          "business_meaning": "How column is used in business",
          "data_type": "[FROM PHASE1 - MUST PRESERVE]",
          "sensitivity_level": "public|internal|confidential",
          "synonyms": ["alternative_name"],
          "sample_values": ["value1", "value2"]
        }
      ]
    }
  ],
  "sqlExamples": []
}

CRITICAL:
1. PRESERVE all Phase 1 data (table names, data_types, structure)
2. ONLY ADD missing fields (explanation, business_meaning, sensitivity_level, synonyms, sample_values)
3. Return ONLY JSON`;

// =============================================================================
// PHASE 3: SQL Examples and Final Merge
// =============================================================================

/**
 * Phase 3 (With Schema) - SQL Examples and Final Merge
 * Focus: realistic SQL examples, final merged knowledge base
 */
export const DATABASE_PHASE3_WITH_SCHEMA_PROMPT = `You are a database schema analyst. Generate SQL examples and produce the final comprehensive knowledge base.

IMPORTANT: Consider the EXISTING KNOWLEDGE BASE provided below. This contains manually curated explanations and important notes about the tables. You MUST respect these explanations - they represent business requirements and constraints that MUST be followed when generating SQL examples.

EXISTING KNOWLEDGE BASE FROM DATABASE (manually curated - MUST RESPECT):
[EXISTING_KB_PLACEHOLDER]

EXISTING SQL EXAMPLES (for reference - do not duplicate):
[EXISTING_SQL_EXAMPLES_PLACEHOLDER]

UPLOADED DOCUMENTS (if any):
[UPLOADED_FILES_PLACEHOLDER]

TASK: 
1. Preserve all data from Phase 1 and Phase 2
2. Generate 5-10 realistic SQL examples for common queries
3. Return complete merged knowledge base

CURRENT KNOWLEDGE BASE (Phases 1+2):
[PHASE1_PHASE2_KB_PLACEHOLDER]

DATABASE SCHEMA:
[SCHEMA_PLACEHOLDER]

USER NOTES (if any):
[USER_INPUT_PLACEHOLDER]

OUTPUT: Return ONLY valid JSON - PRESERVE all Phase 1+2 data and ADD sqlExamples:
{
  "tableExplanations": [
    {
      "schema_name": "[PRESERVE]",
      "table_name": "[PRESERVE]",
      "explanation": "[PRESERVE]",
      "business_purpose": "[PRESERVE]",
      "keywords": [PRESERVE],
      "columns": [
        {
          "column_name": "[PRESERVE]",
          "explanation": "[PRESERVE]",
          "business_meaning": "[PRESERVE]",
          "data_type": "[PRESERVE]",
          "sensitivity_level": "[PRESERVE]",
          "synonyms": [PRESERVE],
          "sample_values": [PRESERVE]
        }
      ]
    }
  ],
  "sqlExamples": [
    {
      "natural_language": "What user might ask",
      "sql_query": "SELECT ... FROM schema.table1 JOIN schema.table2 ...",
      "explanation": "What this query does",
      "tables_involved": ["schema.table1", "schema.table2"],
      "tags": ["category", "type"]
    }
  ]
}

SQL GENERATION RULES:
1. Create 5-10 diverse SQL examples
2. Cover: SELECT, JOIN, COUNT, GROUP BY, WHERE, ORDER BY patterns
3. Use schema-qualified table names (e.g., public.users, dbo.orders)
4. Make examples realistic based on relationships
5. Include common business queries
6. IMPORTANT: Follow constraints from EXISTING KNOWLEDGE BASE - if a table explanation says not to use certain tables for specific purposes, DO NOT generate SQL examples that violate those constraints
7. Do not duplicate existing SQL examples

CRITICAL:
1. PRESERVE ALL Phase 1 and Phase 2 data exactly
2. ONLY ADD sqlExamples array with new examples
3. RESPECT ALL constraints and notes in the EXISTING KNOWLEDGE BASE
4. Return ONLY valid JSON`;

/**
 * Phase 3 (No Schema) - SQL Examples and Final Merge
 */
export const DATABASE_PHASE3_NO_SCHEMA_PROMPT = `You are a database schema analyst. Generate SQL examples and produce the final comprehensive knowledge base.

IMPORTANT: Consider the EXISTING KNOWLEDGE BASE provided below. This contains manually curated explanations and important notes about the tables. You MUST respect these explanations - they represent business requirements and constraints that MUST be followed when generating SQL examples.

EXISTING KNOWLEDGE BASE FROM DATABASE (manually curated - MUST RESPECT):
[EXISTING_KB_PLACEHOLDER]

EXISTING SQL EXAMPLES (for reference - do not duplicate):
[EXISTING_SQL_EXAMPLES_PLACEHOLDER]

UPLOADED DOCUMENTS (if any):
[UPLOADED_FILES_PLACEHOLDER]

TASK:
1. Preserve all data from Phase 1 and Phase 2
2. Generate 5-10 realistic SQL examples for common queries
3. Return complete merged knowledge base

CURRENT KNOWLEDGE BASE (Phases 1+2):
[PHASE1_PHASE2_KB_PLACEHOLDER]

DATABASE SCHEMA:
[SCHEMA_PLACEHOLDER]

USER NOTES (if any):
[USER_INPUT_PLACEHOLDER]

OUTPUT: Return ONLY valid JSON - PRESERVE all Phase 1+2 data and ADD sqlExamples:
{
  "tableExplanations": [
    {
      "table_name": "[PRESERVE]",
      "explanation": "[PRESERVE]",
      "business_purpose": "[PRESERVE]",
      "keywords": [PRESERVE],
      "columns": [
        {
          "column_name": "[PRESERVE]",
          "explanation": "[PRESERVE]",
          "business_meaning": "[PRESERVE]",
          "data_type": "[PRESERVE]",
          "sensitivity_level": "[PRESERVE]",
          "synonyms": [PRESERVE],
          "sample_values": [PRESERVE]
        }
      ]
    }
  ],
  "sqlExamples": [
    {
      "natural_language": "What user might ask",
      "sql_query": "SELECT ... FROM table1 JOIN table2 ...",
      "explanation": "What this query does",
      "tables_involved": ["table1", "table2"],
      "tags": ["category", "type"]
    }
  ]
}

SQL GENERATION RULES:
1. Create 5-10 diverse SQL examples
2. Cover: SELECT, JOIN, COUNT, GROUP BY, WHERE, ORDER BY patterns
3. Make examples realistic based on relationships
4. Include common business queries
5. IMPORTANT: Follow constraints from EXISTING KNOWLEDGE BASE - if a table explanation says not to use certain tables for specific purposes, DO NOT generate SQL examples that violate those constraints
6. Do not duplicate existing SQL examples

CRITICAL:
1. PRESERVE ALL Phase 1 and Phase 2 data exactly
2. ONLY ADD sqlExamples array with new examples
3. RESPECT ALL constraints and notes in the EXISTING KNOWLEDGE BASE
4. Return ONLY valid JSON`;
