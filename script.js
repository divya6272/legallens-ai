(function () {
  'use strict';

  const form = document.getElementById('assist-form');
  const textBWrap = document.getElementById('text-b-wrap');
  const questionWrap = document.getElementById('question-wrap');
  const textB = document.getElementById('text-b');
  const question = document.getElementById('question');
  const submitBtn = document.getElementById('submit-btn');
  const resultSection = document.getElementById('result-section');
  const resultOutput = document.getElementById('result-output');
  const labelA = document.getElementById('label-a');

  const FIELD_LABELS = {
    simplify: 'Document text',
    compare: 'First document (Document A)',
    analyze: 'Document text',
    ask: 'Document text',
    checklist: 'Document text',
    'prep-lawyer': 'Document text',
  };

  function currentTask() {
    return form.querySelector('input[name="task"]:checked').value;
  }

  function syncVisibleFields() {
    const task = currentTask();
    textBWrap.hidden = task !== 'compare';
    questionWrap.hidden = task !== 'ask';
    textB.required = task === 'compare';
    question.required = task === 'ask';
    labelA.textContent = FIELD_LABELS[task] || 'Document text';
  }

  form.addEventListener('change', (e) => {
    if (e.target.name === 'task') syncVisibleFields();
  });
  syncVisibleFields();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const task = currentTask();
    const payload = {
      task,
      text: document.getElementById('text-a').value.trim(),
      textB: textB.value.trim(),
      question: question.value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Analyzing…';
    resultSection.hidden = false;
    resultOutput.innerHTML = '<p class="hint">Working on it…</p>';

    try {
      const res = await fetch('/api/legal-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        resultOutput.innerHTML = `<div class="error-box" role="alert">${escapeHtml(data.error || 'Something went wrong.')}</div>`;
      } else {
        resultOutput.textContent = data.result;
        resultOutput.focus();
      }
    } catch (err) {
      resultOutput.innerHTML = '<div class="error-box" role="alert">Network error. Please check your connection and try again.</div>';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Analyze';
    }
  });

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
