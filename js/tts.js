// Text-to-speech helper: Listen + Repeat buttons using the on-device Web Speech API.
// Works fully offline on most platforms (iOS/Android/desktop OS voices), no network needed
// once the page has loaded and the browser has enumerated its voices.

const TTS = (() => {
  let lastText = null;
  let lastLang = 'ja-JP';

  function speak(text, lang = 'ja-JP') {
    if (!('speechSynthesis' in window)) {
      alert('Speech playback is not supported on this device/browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 0.9;
    lastText = text;
    lastLang = lang;
    window.speechSynthesis.speak(utter);
  }

  function repeat() {
    if (lastText) speak(lastText, lastLang);
  }

  // Returns an HTML snippet (string) for a listen+repeat button pair wired via data attributes.
  function buttons(text, lang = 'ja-JP') {
    const safe = text.replace(/'/g, "\\'");
    return `
      <button class="speak-btn" title="Listen" onclick="TTS.speak('${safe}', '${lang}')">🔊</button>
      <button class="speak-btn" title="Repeat" onclick="TTS.repeat()">🔁</button>
    `;
  }

  return { speak, repeat, buttons };
})();
