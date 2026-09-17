import { OfficialRowObject } from './types';

export interface RowScanResult {
  byteStart: number;
  byteEnd: number;
  rowObject: OfficialRowObject;
  sliceLength: number;
}

export async function locateOfficialRow(
  commit: string,
  targetResultId: string
): Promise<RowScanResult> {
  const matches = await locateOfficialRows(commit, targetResultId);
  return matches[0];
}

export async function locateOfficialRows(
  commit: string,
  targetResultId: string
): Promise<RowScanResult[]> {
  const cleanCommit = commit.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(cleanCommit)) {
    throw new Error('Official commit must be a 40-character lowercase hex string.');
  }

  const cleanResultId = targetResultId.trim();
  if (!/^6\.0-[0-9]{4}$/.test(cleanResultId)) {
    throw new Error('Result ID must be in the format 6.0-NNNN.');
  }

  const url = `https://api.github.com/repos/mlcommons/inference_results_v6.0/contents/summary_results.json?ref=${cleanCommit}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch official results repository file (HTTP ${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (bytes.length === 0) {
    throw new Error('Official results file is empty.');
  }

  return scanArrayBufferForOfficialRows(bytes, cleanResultId);
}

export function scanArrayBufferForOfficialRow(
  bytes: Uint8Array,
  targetResultId: string
): RowScanResult {
  return scanArrayBufferForOfficialRows(bytes, targetResultId)[0];
}

export function scanArrayBufferForOfficialRows(
  bytes: Uint8Array,
  targetResultId: string
): RowScanResult[] {
  const len = bytes.length;
  let i = 0;

  // Find top-level array start '['
  while (i < len && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) {
    i++;
  }
  if (i >= len || bytes[i] !== 0x5b) {
    throw new Error('Expected top-level JSON array in summary_results.json.');
  }
  i++; // Move past '['

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const matches: RowScanResult[] = [];
  let arrayClosed = false;

  while (i < len) {
    // Skip whitespace and commas
    while (
      i < len &&
      (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x2c)
    ) {
      i++;
    }

    if (i >= len) {
      break;
    }

    if (bytes[i] === 0x5d) {
      // ']' array close
      arrayClosed = true;
      i++;
      break;
    }

    if (bytes[i] !== 0x7b) {
      // '{' object start
      throw new Error(`Unexpected token at byte ${i}; expected JSON object '{'.`);
    }

    const objStart = i;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let objEnd = -1;

    while (i < len) {
      const b = bytes[i];

      if (inString) {
        if (escapeNext) {
          escapeNext = false;
        } else if (b === 0x5c) {
          // '\'
          escapeNext = true;
        } else if (b === 0x22) {
          // '"'
          inString = false;
        }
      } else {
        if (b === 0x22) {
          inString = true;
        } else if (b === 0x7b || b === 0x5b) {
          // '{' or '['
          depth++;
        } else if (b === 0x7d || b === 0x5d) {
          // '}' or ']'
          depth--;
          if (depth === 0) {
            objEnd = i;
            i++;
            break;
          }
        }
      }
      i++;
    }

    if (objEnd === -1 || depth !== 0) {
      throw new Error('Unterminated object in official summary results JSON.');
    }

    const sliceLength = objEnd - objStart + 1;
    if (sliceLength > 16384) {
      throw new Error(
        `Row slice at byte ${objStart}-${objEnd} exceeds maximum allowed length of 16384 bytes (${sliceLength} bytes).`
      );
    }

    const slice = bytes.subarray(objStart, objEnd + 1);
    let decodedText: string;
    try {
      decodedText = decoder.decode(slice);
    } catch {
      throw new Error(`UTF-8 decode failed for byte slice ${objStart}-${objEnd}.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(decodedText);
    } catch {
      throw new Error(`JSON parse failed for byte slice ${objStart}-${objEnd}.`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Slice ${objStart}-${objEnd} is not a valid JSON object.`);
    }

    const objMap = parsed as Record<string, unknown>;
    const rawId = objMap.ID || objMap.id || objMap.Result_ID;
    if (rawId === undefined || rawId === null || typeof rawId !== 'string' || !rawId.trim()) {
      throw new Error(`Row at ${objStart}-${objEnd} is missing an ID field.`);
    }
    const id = rawId.trim();

    if (id === targetResultId) {
      matches.push({
        byteStart: objStart,
        byteEnd: objEnd,
        rowObject: normalizeRowFields(objMap),
        sliceLength,
      });
    }
  }

  if (!arrayClosed) {
    throw new Error('Unclosed top-level JSON array in summary_results.json.');
  }

  // Check for non-whitespace trailing data
  while (i < len) {
    if (bytes[i] !== 0x20 && bytes[i] !== 0x09 && bytes[i] !== 0x0a && bytes[i] !== 0x0d) {
      throw new Error('Unexpected non-whitespace trailing data after top-level JSON array.');
    }
    i++;
  }

  if (matches.length === 0) {
    throw new Error(`Result ID '${targetResultId}' was not found in official summary results.`);
  }

  return matches;
}

function normalizeRowFields(raw: Record<string, unknown>): OfficialRowObject {
  const getField = (...keys: string[]): string => {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null) {
        if (typeof raw[k] === 'object') {
          return JSON.stringify(raw[k]);
        }
        return String(raw[k]).trim();
      }
    }
    return '';
  };

  return {
    release: '6.0',
    result_id: getField('ID', 'id', 'Result_ID', 'result_id'),
    submitter: getField('Submitter', 'submitter'),
    availability: getField('Availability', 'availability'),
    category: getField('Category', 'category'),
    suite: getField('Suite', 'suite'),
    system: getField('System', 'system'),
    platform: getField('Platform', 'platform'),
    used_model: getField('Used_Model', 'used_model', 'UsedModel'),
    model: getField('Model', 'model'),
    scenario: getField('Scenario', 'scenario'),
    accuracy: getField('Accuracy', 'accuracy'),
    nodes: getField('Nodes', 'nodes'),
    processor: getField('Processor', 'processor'),
    host_processors_per_node: getField('host_processors_per_node', 'Host_Processors_Per_Node', 'HostProcessorsPerNode'),
    host_processor_core_count: getField(
      'host_processor_core_count',
      'Host_Processor_Core_Count',
      'HostProcessorCoreCount'
    ),
    accelerator: getField('Accelerator', 'accelerator'),
    accelerators_per_node: getField('a#', 'A#', 'accelerators_per_node', 'Accelerators_Per_Node', 'AcceleratorsPerNode'),
    total_accelerators: getField('Total Accelerators', 'total_accelerators', 'Total_Accelerators', 'TotalAccelerators'),
    software: getField('Software', 'software'),
    operating_system: getField('operating_system', 'Operating_System', 'OperatingSystem', 'OS'),
    performance_result: getField('Performance_Result', 'performance_result', 'PerformanceResult'),
    performance_units: getField('Performance_Units', 'performance_units', 'PerformanceUnits'),
    has_power: getField('has_power', 'Has_Power', 'HasPower'),
    inferred: getField('Inferred', 'inferred'),
    compliance: getField('Compliance', 'compliance'),
    errors: getField('Errors', 'errors'),
  };
}
