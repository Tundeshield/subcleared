// @vitest-environment jsdom
// Regression: typing in a form inside a dialog or drawer must never move focus.
// The bug: the overlay's focus effect depended on `onClose`, which callers pass
// inline, so every keystroke re-ran it and focus jumped to the first field.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, Drawer, newRowKey } from '../src/ui';

afterEach(cleanup);
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

function DrawerForm() {
  // Form state lives in the same component that renders the overlay, with an inline onClose: the original bug's shape.
  const [f, setF] = useState({ company: '', trade: '', email: '' });
  return (
    <Drawer open onClose={() => setF({ ...f })} title="Add subcontractors">
      <label>Company name<input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
      <label>Trade<input value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} /></label>
      <label>Contact email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
    </Drawer>
  );
}

function DialogForm() {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState('a');
  return (
    <Dialog open onClose={() => setName(name)} title="New project">
      <label>Project name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}><option value="a">A</option><option value="b">B</option></select></label>
      <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </Dialog>
  );
}

function Rows() {
  const [rows, setRows] = useState(() => [0, 1, 2].map(() => ({ k: newRowKey(), v: '' })));
  return (
    <div>{rows.map((r, i) => (
      <div key={r.k}><label>Row {i + 1}<input value={r.v} onChange={(e) => setRows(rows.map((x) => (x.k === r.k ? { ...x, v: e.target.value } : x)))} /></label>
        <button onClick={() => setRows(rows.filter((x) => x.k !== r.k))}>Remove {i + 1}</button></div>
    ))}</div>
  );
}

describe('input focus in overlays', () => {
  it('keeps focus in each field of a drawer while typing continuously', async () => {
    const user = userEvent.setup();
    render(<DrawerForm />);
    await wait(50); // initial focus goes to the first field once
    expect(document.activeElement).toBe(screen.getByLabelText('Company name'));
    for (const [label, text] of [['Company name', 'Lee Electrical'], ['Trade', 'Electrical'], ['Contact email', 'aoife@lee.example']]) {
      const el = screen.getByLabelText(label) as HTMLInputElement;
      await user.click(el);
      for (const ch of text) { await user.keyboard(ch); await wait(40); }
      expect(el.value).toBe(text);
      expect(document.activeElement).toBe(el);
    }
  });

  it('keeps focus in inputs, selects and textareas in a dialog, and supports Tab and Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<DialogForm />);
    await wait(50);
    const notes = screen.getByLabelText('Notes') as HTMLTextAreaElement;
    await user.click(notes);
    for (const ch of 'Line one') { await user.keyboard(ch); await wait(40); }
    expect(notes.value).toBe('Line one');
    expect(document.activeElement).toBe(notes);
    await user.click(screen.getByLabelText('Project name'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('Kind'));
    await user.selectOptions(screen.getByLabelText('Kind'), 'b');
    await wait(40);
    expect(document.activeElement).toBe(screen.getByLabelText('Kind'));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Project name'));
  });

  it('keeps each row’s text with its row when another row is removed', async () => {
    const user = userEvent.setup();
    render(<Rows />);
    await user.type(screen.getByLabelText('Row 2'), 'second');
    await user.type(screen.getByLabelText('Row 3'), 'third');
    await user.click(screen.getByText('Remove 1'));
    expect((screen.getByLabelText('Row 1') as HTMLInputElement).value).toBe('second');
    expect((screen.getByLabelText('Row 2') as HTMLInputElement).value).toBe('third');
  });
});
