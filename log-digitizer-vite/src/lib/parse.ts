/**
 * CSV/TSV/whitespace-separated text parser for TC (I-t) curve data
 * 
 * Usage example:
 * ```ts
 * const text = "t,i\n0.01,3000\n0.10,1500";
 * const samples = parseCsvToSamples(text);
 * ```
 */

import type { Sample } from "./i2t";

/**
 * Parse CSV/TSV/space-separated text with optional header into Sample[].
 * Accepts "t, i" or "time, current" style columns.
 * Ignores blank/invalid lines.
 * 
 * Supports:
 * - Comma-separated (CSV)
 * - Tab-separated (TSV)
 * - Whitespace-separated
 * - Headers: "t,i", "time,current", "t i", etc.
 * - Case-insensitive column detection
 * 
 * @param text - Input text to parse
 * @returns Array of {t, i} samples sorted by time
 */
export function parseCsvToSamples(text: string): Sample[] {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];
  
  // Detect separator: comma, tab, or whitespace
  const firstLine = lines[0];
  let separator: string | RegExp = /\s+/;
  if (firstLine.includes(',')) separator = ',';
  else if (firstLine.includes('\t')) separator = '\t';
  
  // Parse header (if present) to find column indices
  const header = lines[0].split(separator).map(s => s.trim().toLowerCase());
  let tIdx = -1;
  let iIdx = -1;
  
  // Find time column (t, time, t[s], etc.)
  tIdx = header.findIndex(h => 
    /^t($|\[|\(|s|sec|time)/i.test(h) || h === 't'
  );
  
  // Find current column (i, current, i[a], etc.)
  iIdx = header.findIndex(h => 
    /^i($|\[|\(|a|amp|current)/i.test(h) || h === 'current'
  );
  
  // If header not found, assume first two columns
  const isHeader = tIdx >= 0 && iIdx >= 0;
  const startLine = isHeader ? 1 : 0;
  
  if (!isHeader) {
    tIdx = 0;
    iIdx = 1;
  }
  
  const samples: Sample[] = [];
  
  for (let i = startLine; i < lines.length; i++) {
    const parts = lines[i].split(separator).map(s => s.trim());
    if (parts.length < Math.max(tIdx, iIdx) + 1) continue;
    
    const t = parseFloat(parts[tIdx]);
    const i = parseFloat(parts[iIdx]);
    
    if (isNaN(t) || isNaN(i) || t < 0 || i < 0) continue;
    
    samples.push({ t, i });
  }
  
  // Sort by time
  samples.sort((a, b) => a.t - b.t);
  
  return samples;
}

