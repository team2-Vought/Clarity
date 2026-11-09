// Privacy Policy and Terms of Use — same shape as legal.uk.js.
// The operator and contact come from VITE_LEGAL_OPERATOR / VITE_CONTACT_EMAIL (see legalContact).
// Have a lawyer review the text before launch and update `updated` with every change.

export const legalEn = {
  updated: 'Last updated: November 8, 2026',
  back: 'Back',
  otherDoc: { privacy: 'Terms of Use', terms: 'Privacy Policy' },
  // `contact` у текстах — готова дія: «email …» або «use the form …»
  contactEmail: (email) => `email ${email}`,
  contactFallback: 'use the “Found a bug?” form at the bottom of any page',
  privacy: {
    title: 'Privacy Policy',
    lead: 'What Clarity stores about you, why, who else sees it and how to delete it.',
    sections: [
      {
        title: 'Who we are',
        body: (op, contact) => [
          `Clarity is operated by ${op}. We are responsible for the personal data described below. For any privacy question or request, ${contact}.`,
        ],
      },
      {
        title: 'What we store',
        body: () => [
          'Account: name, email, password hash (we never see the password itself), photo if you add one, the date you joined, and whether your email is confirmed.',
          '“About me”: the profile you fill in yourself in Settings. It is optional and you can switch it off for any discussion.',
          'Discussions: your questions, follow-up answers, notes, attachments (file name, size and the text read from the file — the file itself is not kept), the participants’ replies, conclusions, decision trees, marks and journal entries.',
          'API keys you add in Settings — stored encrypted and used only for your discussions.',
          'Sign-ins: a separate key per device (only its hash is stored), the device name and the time of last use; the IP address of failed sign-in attempts, to stop password guessing.',
          'Reports sent with “Found a bug?”: your message and, only if you leave them checked, technical details (browser, screen, recent errors) and the discussion.',
        ],
      },
      {
        title: 'Why we use it',
        body: () => [
          'To run the service you asked for: hold discussions, keep your history and journal, and send the emails you expect (email confirmation, password reset, journal reminders).',
          'To keep the service safe: limits, protection against password guessing and abuse.',
          'We do not sell your data, do not show ads and do not use your discussions to train models.',
        ],
      },
      {
        title: 'Who else receives data',
        body: () => [
          'AI model providers. To get a reply, the text of the discussion (question, context, “About me” if enabled, attachment text) is sent to the provider of each participant’s model — for example OpenAI, Anthropic, Google, Groq, Cerebras, DeepSeek, Mistral or OpenRouter. Their own privacy terms apply to what they receive.',
          'Web search. When participants look up facts, short search queries (not your whole discussion) go to the configured search service — Tavily, Brave, SearXNG or Wikipedia.',
          'Google — only if you sign in with Google: we receive your name and confirmed email.',
          'Anyone with a public link — only for a discussion you shared yourself. Your “About me” never goes into a public link. You can close the link at any time.',
        ],
      },
      {
        title: 'Cookies and browser storage',
        body: () => [
          'One essential cookie keeps you signed in; JavaScript cannot read it. The browser also remembers your device settings (theme, language, accessibility mode) and an unsent question draft. There is no advertising or analytics tracking.',
        ],
      },
      {
        title: 'How long we keep it',
        body: () => [
          'While your account exists. A discussion you delete is deleted together with its attachments. When you delete the account, all of its data is deleted.',
          'Device sign-ins expire on their own; failed sign-in records are cleared after a successful sign-in.',
        ],
      },
      {
        title: 'Your rights',
        body: (op, contact) => [
          'In Settings → Security & data you can download all your data in one file, sign out of other devices and delete the account.',
          `You can also ask us to access, correct, delete or restrict your data, or object to its processing — to do so, ${contact}. If you are in the EU/EEA or the UK, you may complain to your data protection authority.`,
        ],
      },
      {
        title: 'Age',
        body: () => ['Clarity is not intended for people under 16.'],
      },
      {
        title: 'Changes',
        body: () => [
          'If this policy changes in a way that matters, we will tell you in the app or by email before the change takes effect.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Use',
    lead: 'The rules for using Clarity. By creating an account you accept them.',
    sections: [
      {
        title: 'The service',
        body: (op) => [
          `Clarity, operated by ${op}, lets several AI participants discuss your question and gives you a summarised conclusion. Replies are generated by language models.`,
        ],
      },
      {
        title: 'Not professional advice',
        body: () => [
          'AI replies can be wrong, incomplete or out of date. Clarity helps you think a decision through but does not replace a doctor, lawyer, financial adviser or psychologist. You make the decision and you are responsible for it.',
          'If you are in crisis or your life is in danger, contact local emergency services right away.',
        ],
      },
      {
        title: 'Your account',
        body: () => [
          'You must be at least 16. Give a real email and keep your password safe. You are responsible for what happens in your account.',
        ],
      },
      {
        title: 'Acceptable use',
        body: () => [
          'Do not use Clarity to break the law, to harm or harass other people, to create content that sexualises minors, to get around limits or security, or to overload the service with automated requests.',
          'Do not upload files you have no right to share.',
        ],
      },
      {
        title: 'Your content',
        body: () => [
          'Your questions, files and discussions remain yours. You let us process them only to provide the service — including sending them to the AI providers you chose. Public links show a discussion only when you create one.',
        ],
      },
      {
        title: 'Limits and your own keys',
        body: () => [
          'Free use has daily limits. With your own API key there is no Clarity limit, but the provider bills you for its calls under its own terms.',
        ],
      },
      {
        title: 'Availability and liability',
        body: () => [
          'We work to keep Clarity running but provide it “as is”, without guarantees of uninterrupted operation or of the accuracy of AI replies. To the extent allowed by law, we are not liable for decisions made on the basis of the replies.',
        ],
      },
      {
        title: 'Ending use',
        body: () => [
          'You can delete your account at any time in Settings. We may suspend an account that breaks these terms.',
        ],
      },
      {
        title: 'Changes and contact',
        body: (op, contact) => [
          `We will announce important changes in advance. For questions about these terms, ${contact}.`,
        ],
      },
    ],
  },
};
