/**
 * Buffer search functionality
 *
 * Provides regex and plain text search capabilities for output buffers
 */

import type { OutputLine } from './circular-buffer.js';

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  direction?: 'forward' | 'backward';
}

export interface SearchMatch {
  start: number;    // Character index in line
  end: number;      // Character index in line
  text: string;     // Matched text
}

export interface SearchResult {
  lineNumber: number;
  line: OutputLine;
  matches: SearchMatch[];
}

/**
 * Search functionality for output buffers
 */
export class BufferSearch {
  /**
   * Search for a pattern in a buffer
   */
  search(
    lines: OutputLine[],
    pattern: string,
    options: SearchOptions = {}
  ): SearchResult[] {
    const {
      regex = false,
      caseSensitive = false,
      direction = 'forward',
    } = options;

    if (!pattern) {
      return [];
    }

    // Build search regex
    let searchRegex: RegExp;
    try {
      if (regex) {
        // User provided regex pattern
        const flags = caseSensitive ? 'g' : 'gi';
        searchRegex = new RegExp(pattern, flags);
      } else {
        // Plain text search - escape special regex characters
        const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = caseSensitive ? 'g' : 'gi';
        searchRegex = new RegExp(escapedPattern, flags);
      }
    } catch (error) {
      // Invalid regex pattern
      return [];
    }

    const results: SearchResult[] = [];

    // Search through lines
    const linesToSearch = direction === 'backward' ? [...lines].reverse() : lines;

    for (const line of linesToSearch) {
      const matches: SearchMatch[] = [];
      let match: RegExpExecArray | null;

      // Reset regex state
      searchRegex.lastIndex = 0;

      // Find all matches in this line
      while ((match = searchRegex.exec(line.content)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        });

        // Prevent infinite loop on zero-length matches
        if (match.index === searchRegex.lastIndex) {
          searchRegex.lastIndex++;
        }
      }

      if (matches.length > 0) {
        results.push({
          lineNumber: line.lineNumber,
          line,
          matches,
        });
      }
    }

    // If backward search, reverse results to maintain line order
    if (direction === 'backward') {
      results.reverse();
    }

    return results;
  }

  /**
   * Find next match after a given line number
   */
  findNext(
    results: SearchResult[],
    currentLine: number
  ): SearchResult | null {
    const index = results.findIndex((r) => r.lineNumber > currentLine);
    if (index === -1) {
      // Wrap around to first result
      return results[0] ?? null;
    }
    return results[index];
  }

  /**
   * Find previous match before a given line number
   */
  findPrevious(
    results: SearchResult[],
    currentLine: number
  ): SearchResult | null {
    // Search backwards
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].lineNumber < currentLine) {
        return results[i];
      }
    }
    // Wrap around to last result
    return results[results.length - 1] ?? null;
  }

  /**
   * Highlight matches in a line
   * Returns the line content with ANSI color codes for highlights
   */
  highlightMatches(
    line: string,
    matches: SearchMatch[],
    highlightColor: string = '\x1b[43m\x1b[30m' // Yellow background, black text
  ): string {
    if (matches.length === 0) {
      return line;
    }

    const reset = '\x1b[0m';
    let result = '';
    let lastIndex = 0;

    // Sort matches by start position
    const sortedMatches = [...matches].sort((a, b) => a.start - b.start);

    for (const match of sortedMatches) {
      // Add text before match
      result += line.slice(lastIndex, match.start);
      // Add highlighted match
      result += highlightColor + match.text + reset;
      lastIndex = match.end;
    }

    // Add remaining text
    result += line.slice(lastIndex);

    return result;
  }

  /**
   * Count total matches across all results
   */
  countMatches(results: SearchResult[]): number {
    return results.reduce((sum, result) => sum + result.matches.length, 0);
  }
}
