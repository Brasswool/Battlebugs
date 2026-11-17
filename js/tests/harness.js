// Tiny in-browser test harness — no npm, no build step.
const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function ok(value, msg) {
  if (!value) throw new Error(msg || 'Expected a truthy value');
}

export function eq(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${msg || 'eq'}: expected ${fmt(expected)}, received ${fmt(actual)}`);
  }
}

export function near(actual, expected, eps = 1e-6, msg) {
  if (!(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${msg || 'near'}: expected ~${fmt(expected)}, received ${fmt(actual)}`);
  }
}

export function throws(fn, msg) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(msg || 'Expected the function to throw');
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export function runAll(container) {
  const results = [];
  const list = document.getElementById('list') || container;

  for (const t of tests) {
    let error = null;
    const started = performance.now();
    try {
      t.fn();
    } catch (e) {
      error = e;
    }
    results.push({ name: t.name, error, ms: performance.now() - started });
  }

  const frag = document.createDocumentFragment();
  for (const r of results) {
    const row = document.createElement('div');
    row.className = `trow ${r.error ? 'tfail' : 'tpass'}`;
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = r.error ? '✕' : '✓';
    const label = document.createElement('span');
    label.textContent = r.name;
    row.append(mark, label);
    if (r.error) {
      const why = document.createElement('div');
      why.className = 'why';
      why.textContent = r.error.message + (r.error.stack ? `\n${String(r.error.stack).split('\n')[1] || ''}` : '');
      row.append(why);
    }
    frag.append(row);
  }

  const passed = results.filter((r) => !r.error).length;
  const failed = results.length - passed;

  const summary = document.createElement('div');
  summary.className = `summary ${failed ? 'bad' : 'good'}`;
  summary.textContent = failed
    ? `${passed} passed · ${failed} failed · ${results.length} total`
    : `${passed}/${results.length} tests passed — rules engine healthy`;

  list.append(frag, summary);

  window.__results = { results, passed, failed };
  console.log(`[chitin tests] ${passed}/${results.length} passed`, failed ? results.filter((r) => r.error) : '');
  return { results, passed, failed };
}
