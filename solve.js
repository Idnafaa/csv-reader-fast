// Fast CSV reader that reproduces csv-reader 1.0.0's broken-row policy
// exactly: same {columns, rows, errors} for every {text, header} input.
//
// How it stays fast: one left-to-right pass driven by char codes. A plain
// field is found by scanning to the next comma, LF or CR and then cut out
// with a single slice, so the common path builds no intermediate strings;
// that scan is inlined in the field loop. A quoted field first locates its
// closing quote by jumping from quote to quote with indexOf (stepping over
// doubled quotes, and remembering whether any were seen), then walks the
// content once to count lines and fold CR/CRLF into LF; content without
// escapes or CRs is again a single slice. The rare broken shapes (stray CRs
// outside quotes, junk after a closing quote, a quote that never closes)
// take slower segment-joining paths that preserve the reference error order.

const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;
const BOM = 0xfeff;

// How a field ended: the record goes on, the record ends at a line break, or
// the text ran out.
const BY_COMMA = 0;
const BY_LINE = 1;
const BY_END = 2;

export function run(input) {
  const text = String(input.text);
  const wantHeader = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let i = 0; // cursor: next code unit to read
  let lineNo = 1; // 1-based line the cursor sits on
  if (n > 0 && text.charCodeAt(0) === BOM) i = 1;

  // The record under construction: where it started and the rows index it
  // will take (null while the header record is being read).
  let recLine = 1;
  let recRow = null;

  // Scratch results shared with the bare-field scanner below, which handles
  // the stretches the inlined fast path cannot: text after a closing quote,
  // the re-read of an unterminated quote, and fields holding stray CRs.
  let bareValue = '';
  let bareTerm = BY_END;
  let bareAdded = 0;

  // Scan an unquoted stretch starting at the cursor, appending whatever is
  // kept to `head`. Sets bareValue / bareTerm / bareAdded (bareAdded counts
  // only the characters this stretch kept, not head's) and moves the cursor
  // past the terminator. A CR not followed by LF is dropped with a stray_cr
  // error, one per CR, in the order met.
  function scanBare(head) {
    let j = i;
    while (j < n) {
      const cc = text.charCodeAt(j);
      if (cc === COMMA || cc === LF || cc === CR) break;
      j++;
    }
    if (j >= n) {
      bareValue = head === '' ? text.slice(i, j) : head + text.slice(i, j);
      bareAdded = j - i;
      bareTerm = BY_END;
      i = j;
      return;
    }
    const cc = text.charCodeAt(j);
    if (cc === COMMA) {
      bareValue = head === '' ? text.slice(i, j) : head + text.slice(i, j);
      bareAdded = j - i;
      bareTerm = BY_COMMA;
      i = j + 1;
      return;
    }
    if (cc === LF) {
      bareValue = head === '' ? text.slice(i, j) : head + text.slice(i, j);
      bareAdded = j - i;
      bareTerm = BY_LINE;
      i = j + 1;
      lineNo++;
      return;
    }
    if (j + 1 < n && text.charCodeAt(j + 1) === LF) {
      bareValue = head === '' ? text.slice(i, j) : head + text.slice(i, j);
      bareAdded = j - i;
      bareTerm = BY_LINE;
      i = j + 2;
      lineNo++;
      return;
    }
    // A stray CR: keep the stretch so far, drop the CR, and continue in
    // segments so further stray CRs are handled the same way.
    let built = head + text.slice(i, j);
    let added = j - i;
    errors.push({ code: 'stray_cr', line: recLine, row: recRow });
    j++;
    let segStart = j;
    for (;;) {
      while (j < n) {
        const c2 = text.charCodeAt(j);
        if (c2 === COMMA || c2 === LF || c2 === CR) break;
        j++;
      }
      built += text.slice(segStart, j);
      added += j - segStart;
      if (j >= n) {
        bareValue = built;
        bareAdded = added;
        bareTerm = BY_END;
        i = j;
        return;
      }
      const c2 = text.charCodeAt(j);
      if (c2 === COMMA) {
        bareValue = built;
        bareAdded = added;
        bareTerm = BY_COMMA;
        i = j + 1;
        return;
      }
      if (c2 === LF) {
        bareValue = built;
        bareAdded = added;
        bareTerm = BY_LINE;
        i = j + 1;
        lineNo++;
        return;
      }
      if (j + 1 < n && text.charCodeAt(j + 1) === LF) {
        bareValue = built;
        bareAdded = added;
        bareTerm = BY_LINE;
        i = j + 2;
        lineNo++;
        return;
      }
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      j++;
      segStart = j;
    }
  }

  for (;;) {
    // Blank lines (an LF or CRLF with nothing before it) hold no record.
    while (i < n) {
      const cc = text.charCodeAt(i);
      if (cc === LF) {
        i++;
        lineNo++;
      } else if (cc === CR && i + 1 < n && text.charCodeAt(i + 1) === LF) {
        i += 2;
        lineNo++;
      } else {
        break;
      }
    }
    if (i >= n) break;

    recLine = lineNo;
    recRow = wantHeader && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let term = BY_COMMA;
    while (term === BY_COMMA) {
      let value;
      if (i < n && text.charCodeAt(i) === QUOTE) {
        lastQuoted = true;
        const open = i;
        // The closing quote is the next quote that is not doubled; note
        // whether any doubled quote was stepped over on the way.
        let close = -1;
        let hasEscape = false;
        let k = open + 1;
        while (k <= n) {
          const q = text.indexOf('"', k);
          if (q === -1) break;
          if (q + 1 < n && text.charCodeAt(q + 1) === QUOTE) {
            hasEscape = true;
            k = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close === -1) {
          // Never closes: the quote is a literal character and the rest is
          // read again as an unquoted field.
          errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
          i = open + 1;
          scanBare('"');
          value = bareValue;
          term = bareTerm;
        } else {
          // Walk the content once: count every LF, CRLF and lone CR as a
          // line and fold CR/CRLF to LF. When no doubled quote was seen the
          // walk needs no quote arm; otherwise each pair becomes one quote.
          // Segments that need folding are accumulated onto `built`; content
          // with nothing to fold stays a single slice.
          let built = null;
          let segStart = open + 1;
          let p = open + 1;
          if (!hasEscape) {
            while (p < close) {
              const cc = text.charCodeAt(p);
              if (cc === CR) {
                built = (built === null ? text.slice(segStart, p) : built + text.slice(segStart, p)) + '\n';
                lineNo++;
                p += p + 1 < close && text.charCodeAt(p + 1) === LF ? 2 : 1;
                segStart = p;
              } else {
                if (cc === LF) lineNo++;
                p++;
              }
            }
          } else {
            while (p < close) {
              const cc = text.charCodeAt(p);
              if (cc === QUOTE) {
                built = (built === null ? text.slice(segStart, p) : built + text.slice(segStart, p)) + '"';
                p += 2;
                segStart = p;
              } else if (cc === CR) {
                built = (built === null ? text.slice(segStart, p) : built + text.slice(segStart, p)) + '\n';
                lineNo++;
                p += p + 1 < close && text.charCodeAt(p + 1) === LF ? 2 : 1;
                segStart = p;
              } else {
                if (cc === LF) lineNo++;
                p++;
              }
            }
          }
          value =
            built === null ? text.slice(open + 1, close) : built + text.slice(segStart, close);
          i = close + 1;
          if (i >= n) {
            term = BY_END;
          } else {
            const cc = text.charCodeAt(i);
            if (cc === COMMA) {
              i++;
              term = BY_COMMA;
            } else if (cc === LF) {
              i++;
              lineNo++;
              term = BY_LINE;
            } else if (cc === CR && i + 1 < n && text.charCodeAt(i + 1) === LF) {
              i += 2;
              lineNo++;
              term = BY_LINE;
            } else {
              // Whatever follows the closing quote, up to the next comma or
              // line break, is appended as it stands.
              scanBare(value);
              if (bareAdded > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
              value = bareValue;
              term = bareTerm;
            }
          }
        }
      } else {
        lastQuoted = false;
        // Plain field, inlined: scan to the next comma, LF or CR and slice.
        // A CR that is not half of a CRLF is a stray CR, handed to scanBare.
        let j = i;
        while (j < n) {
          const cc = text.charCodeAt(j);
          if (cc === COMMA || cc === LF || cc === CR) break;
          j++;
        }
        if (j >= n) {
          value = text.slice(i, j);
          term = BY_END;
          i = j;
        } else {
          const cc = text.charCodeAt(j);
          if (cc === COMMA) {
            value = text.slice(i, j);
            term = BY_COMMA;
            i = j + 1;
          } else if (cc === LF) {
            value = text.slice(i, j);
            term = BY_LINE;
            i = j + 1;
            lineNo++;
          } else if (j + 1 < n && text.charCodeAt(j + 1) === LF) {
            value = text.slice(i, j);
            term = BY_LINE;
            i = j + 2;
            lineNo++;
          } else {
            scanBare('');
            value = bareValue;
            term = bareTerm;
          }
        }
      }
      fields.push(value);
    }

    // A line left with no characters (only stray CRs, since blank lines were
    // skipped above) is no record; its errors stay.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (wantHeader && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: wantHeader ? (columns === null ? [] : columns) : null, rows, errors };
}
