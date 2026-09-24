// prompt.js — the default tone-preserving cleaning prompt (editable in Settings)
// and the per-chunk message builder. This is the exact rule-set validated on the
// Muharram-1405 recordings.

const DEFAULT_PROMPT = `تو ویراستارِ متنِ رونویسیِ گفتاری هستی. متنِ زیر رونویسیِ خودکارِ (STT) یک مجلسِ مذهبی است و پر از غلطِ رونویسی و بی‌نقطه است.

متن را «تمیز» کن، دقیقاً با این قواعد:

۱. لحن را عیناً حفظ کن. هرجا گوینده محاوره‌ای حرف زده محاوره‌ای بماند («می‌گه، می‌خوام، نمی‌دونم، یه، اینا، بذار، باشه، هستش، میفته»)؛ به‌هیچ‌وجه کتابی/رسمی‌اش نکن (اگر گفته «باشه» ننویس «باشد»). هرجا از رویِ متنِ رسمی خوانده شده (روخوانیِ مقتل، زیارت، دعا، شعر) رسمی بماند. هرکدام را همان‌طور که ادا شده بنویس.
۲. فقط غلط‌های واقعیِ رونویسی را اصلاح کن، و عباراتِ عربی/قرآنی/شعر و اسامیِ خاص را درست بنویس. علائمِ نگارشی و پاراگراف‌بندی اضافه کن.
۳. بازنویسی و تلخیص ممنوع. هیچ جمله‌ای را عوض نکن، خلاصه نکن، حذف نکن، و چیزی اضافه نکن. دقیقاً همان چیزی که گفته شده — کامل و وفادار.
۴. سرفصلِ کلانِ برنامه (تغییرِ بخشِ مراسم) را با «# » در ابتدای خط بگذار، با نامی گویا.
۵. تیترِ موضوعیِ داخلِ یک بخش را با «## » در ابتدای خط بگذار.
۶. اگر یک خطِ ذکر/نوحه عیناً چند بار پشت‌سرهم تکرار شده، یک‌بار بنویس و جلویش تعدادِ تکرار را در پرانتز بیاور. غیرِ این، چیزی را کوتاه نکن.
۷. اگر ابتدای متن یک خلاصهٔ خودکار یا هدرِ UI بود، آن را نادیده بگیر و ننویس.
۸. فقط و فقط متنِ تمیزشده را خروجی بده — بدون هیچ مقدمه یا توضیح.`;

// Compose the message actually sent to Gemini for one chunk.
function buildChunkMessage(basePrompt, chunkText, opts = {}) {
  const { index = 1, total = 1, hasNlmSummary = false, insist = false } = opts;
  const lines = [basePrompt.trim(), ''];
  if (insist) {
    // no "last time…" — every chunk now goes to a FRESH chat, so there is no last time to refer to
    lines.push('⚠️ تأکیدِ جدی: این متن را **کاملِ کامل** بنویس — هیچ نکته، جمله یا جزئیاتی را حذف یا خلاصه نکن. هیچ عبارتی مثلِ «به‌طور خلاصه»، «و ادامه دارد» یا سه‌نقطه نگذار؛ تا آخرِ متن بنویس.', '');
  }
  // Each chunk is sent in its OWN fresh chat, so frame it as a self-contained fragment.
  // (Saying "this continues the previous part" made Gemini ask for that part and reply
  // almost empty — the previous part isn't in a fresh chat.)
  if (total > 1) {
    lines.push(`(این «بخش ${index} از ${total}» از یک رونویسیِ طولانی است. ممکن است وسطِ جمله یا وسطِ یک موضوع شروع یا تمام شود — همین بخش را به‌تنهایی و کامل تمیز کن؛ منتظرِ بخش‌های دیگر نباش، دربارهٔ آن‌ها چیزی نپرس، و مقدمه یا جمع‌بندی اضافه نکن. فقط جایی که موضوعِ جدید واقعاً شروع می‌شود هدینگ بگذار.)`);
  }
  if (hasNlmSummary) {
    lines.push('این بخش با یک خلاصهٔ خودکارِ NotebookLM شروع می‌شود؛ آن پاراگراف را کاملاً نادیده بگیر و ننویس.');
  }
  lines.push('---', chunkText);
  return lines.join('\n');
}

// A short "continue from here" nudge when Gemini truncated mid-output.
function buildContinueMessage(lastCoveredSnippet) {
  return `دقیقاً از همین‌جا ادامه بده و بقیهٔ همان بخش را کامل و با همان قواعد بنویس (چیزی را از اول تکرار نکن):\n«…${lastCoveredSnippet}»`;
}

module.exports = { DEFAULT_PROMPT, buildChunkMessage, buildContinueMessage };
