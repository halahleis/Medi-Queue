const nodemailer = require('nodemailer');

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Email service is not configured. Missing ${name}.`);
    err.status = 500;
    throw err;
  }
  return value;
};

const createTransporter = () => {
  const port = Number(process.env.SMTP_PORT || 587);
  const smtpPass = required('SMTP_PASS').replace(/\s+/g, '');
  return nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port,
    secure: port === 465,
    auth: {
      user: required('SMTP_USER'),
      pass: smtpPass,
    },
  });
};

const sendPasswordResetCode = async ({ to, code }) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    const err = new Error('Email service is not configured. Missing SMTP_FROM or SMTP_USER.');
    err.status = 500;
    throw err;
  }

  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from,
      to,
      subject: 'Your MediQueue password reset code',
      text: [
        'Use this code to reset your MediQueue password:',
        '',
        code,
        '',
        'This code expires in 10 minutes. If you did not request it, you can ignore this email.',
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">MediQueue password reset</h2>
          <p>Use this code to reset your MediQueue password:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${code}</div>
          <p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
        </div>
      `,
    });
  } catch (err) {
    if (err?.code === 'EAUTH' || /Username and Password not accepted/i.test(err?.message || '')) {
      const authErr = new Error('Gmail rejected the SMTP credentials. Use a Gmail App Password for SMTP_PASS, not your normal Gmail password.');
      authErr.status = 500;
      throw authErr;
    }
    throw err;
  }
};

const sendMail = async ({ to, subject, text, html }) => {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    const err = new Error('Email service is not configured. Missing SMTP_FROM or SMTP_USER.');
    err.status = 500;
    throw err;
  }

  const transporter = createTransporter();
  await transporter.sendMail({ from, to, subject, text, html });
};

const sendAppointmentEmail = async ({ to, title, lines }) => {
  await sendMail({
    to,
    subject: `MediQueue: ${title}`,
    text: [title, '', ...lines].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#111827">
        <h2 style="margin:0 0 12px">${title}</h2>
        ${lines.map((line) => `<p style="margin:0 0 8px">${line}</p>`).join('')}
      </div>
    `,
  });
};

module.exports = { sendPasswordResetCode, sendMail, sendAppointmentEmail };
