const { getDatTimeUTC } = require("./dateHelper");
const SUPPORT_FOOTER = `
<tr>
  <td style="background-color: #ffffff; padding: 20px; text-align: center; border-top: 1px solid #eee;">
    <p style="margin: 0 0 8px 0; font-size: 14px;">
      <strong>Support:</strong><br/>
      WhatsApp: <a href="https://wa.me/2348164458437" style="color: #2F67FA; text-decoration: none;">
        +234 816 445 8437
      </a><br/>
      Email: <a href="mailto:hello@usefinstack.co" style="color: #2F67FA;">
        hello@usefinstack.co
      </a>
    </p>
    <p style="margin: 0; font-size: 12px; color: #777;">
      © ${new Date().getFullYear()} Finstack. All rights reserved.
    </p>
  </td>
</tr>
`;

const generateNewUserMail = (verificationCode, firstName) => {
  return `
  <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Finstack Account</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
            <!-- Header -->
            <tr>
                <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack</h1>
                    <p style="color: #ffffff; margin: 5px 0 0 0;">Your One-Stop E-commerce Destination</p>
                </td>
            </tr>
            
            <!-- Main Content -->
            <tr>
                <td style="background-color: #ffffff; padding: 30px;">
                    <h2 style="color: #2F67FA; margin: 0 0 20px 0;">Welcome to Finstack!</h2>
                    <p style="line-height: 1.6; margin: 0 0 20px 0;">
                        Dear ${firstName}, thank you for joining Finstack. We're excited to have you on board! 
                        To get started, please verify your email address by clicking the button below.
                    </p>
                    
                    <!-- Verify Button -->
                    <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                        <tr>
                            <td style="background-color: #2F67FA; border-radius: 5px;">
                               
                                <a href="${
                                  process.env.FRONTEND_URL
                                }/verify-email?token=${verificationCode}" style="display: inline-block; padding: 12px 30px; color: #ffffff; 
                                          text-decoration: none; font-weight: bold; font-size: 16px;">
                                    Verify Your Email
                                </a>
                            </td>
                        </tr>
                    </table>
                    
                    <p style="line-height: 1.6; margin: 20px 0 0 0;">
                        If the button doesn't work, you can also copy and paste this link into your browser:
                        <br>
                        <a href="${
                          process.env.FRONTEND_URL
                        }/verify-email?token=${verificationCode}" style="color: #2F67FA; word-break: break-all;">
                        ${
                          process.env.FRONTEND_URL
                        }/verify-email?token=${verificationCode}</a>
                    </p>
                </td>
            </tr>
            
            <!-- Footer -->
          ${SUPPORT_FOOTER}
        </table>
    </body>
    </html>
  `;
};
const generateVerificationSuccessMail = (firstName) => {
  return `
    <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verified - Finstack</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
        <!-- Header -->
        <tr>
            <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack</h1>
                <p style="color: #ffffff; margin: 5px 0 0 0;">Your One-Stop E-commerce Destination</p>
            </td>
        </tr>
        
        <!-- Main Content -->
        <tr>
            <td style="background-color: #ffffff; padding: 30px; text-align: center;">
                <h2 style="color: #2F67FA; margin: 0 0 20px 0;">Email Verified Successfully!</h2>
                
                <!-- Success Icon (using text emoji for email compatibility) -->
                <div style="font-size: 48px; margin: 20px 0;">✅</div>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0;">
                    Congratulations ${firstName}! Your email has been successfully verified. 
                    You're now ready to explore Finstack and enjoy exclusive benefits.
                </p>
                
                <!-- Shop Now Button -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px auto;">
                    <tr>
                        <td style="background-color: #2F67FA; border-radius: 5px;">
                            <a href="${process.env.FRONTEND_URL}" 
                               style="display: inline-block; padding: 12px 30px; color: #ffffff; 
                                      text-decoration: none; font-weight: bold; font-size: 16px;">
                                Start Trading Now
                            </a>
                        </td>
                    </tr>
                </table>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0;">
                    Discover amazing deals, track your orders, and enjoy a seamless 
                    trading experience tailored just for you.
                </p>
            </td>
        </tr>
        
        <!-- Benefits Section -->
        <tr>
            <td style="background-color: #fff5f0; padding: 20px;">
                <table width="100%" cellpadding="10">
                    <tr>
                        <td style="text-align: center; width: 33%;">
                            <p style="color: #2F67FA; font-weight: bold; margin: 0;">Fast Shipping</p>
                            <p style="margin: 5px 0 0 0; font-size: 14px;">Get your orders quickly</p>
                        </td>
                        <td style="text-align: center; width: 33%;">
                            <p style="color: #2F67FA; font-weight: bold; margin: 0;">Exclusive Deals</p>
                            <p style="margin: 5px 0 0 0; font-size: 14px;">Members-only discounts</p>
                        </td>
                        <td style="text-align: center; width: 33%;">
                            <p style="color: #2F67FA; font-weight: bold; margin: 0;">24/7 Support</p>
                            <p style="margin: 5px 0 0 0; font-size: 14px;">We're here to help</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
        
        <!-- Footer -->
      ${SUPPORT_FOOTER}

    </table>
</body>
</html>
    `;
};
const generateVerificationRequest = (firstName, verificationCode) => {
  return `
        <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Re-Request Verification - Finstack</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
        <!-- Header -->
        <tr>
            <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack</h1>
                <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 14px;">Let’s Get You Verified!</p>
            </td>
        </tr>
        
        <!-- Main Content -->
        <tr>
            <td style="background-color: #ffffff; padding: 30px;">
                <h2 style="color: #2F67FA; margin: 0 0 20px 0;">New Verification Requested</h2>
                <p style="line-height: 1.6; margin: 0 0 20px 0;">
                    Hello ${firstName},<br><br>
                    You’ve requested a new verification email for your Finstack account—great choice! 
                    Click the button below to verify your email and unlock your trading experience.
                </p>
                
                <!-- Verify Button -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 20px;">
                    <tr>
                        <td style="background-color: #2F67FA; border-radius: 5px;">
                            <a href="${
                              process.env.FRONTEND_URL
                            }/verify-email/${verificationCode}" 
                               style="display: inline-block; padding: 14px 35px; color: #ffffff; 
                                      text-decoration: none; font-weight: bold; font-size: 16px;">
                                Verify My Email
                            </a>
                        </td>
                    </tr>
                </table>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0; font-size: 14px;">
                    Or use this link:<br>
                    <a href="${
                      process.env.FRONTEND_URL
                    }/verify-email/${verificationCode}" style="color: #2F67FA; word-break: break-all;">
                    
                    ${process.env.FRONTEND_URL}/verify-email/${verificationCode}

                    </a>
                </p>
                
                <p style="line-height: 1.6; margin: 0; color: #666; font-size: 12px;">
                    This link expires in 1 hours. If you didn’t request this verification, 
                    please let us know right away.
                </p>
            </td>
        </tr>
        
        <!-- Quick Note -->
        <tr>
            <td style="background-color: #fff5f0; padding: 20px; font-size: 14px;">
                <p style="margin: 0; line-height: 1.6;">
                    <strong style="color: #2F67FA;">Why Verify?</strong> Get access to exclusive deals, 
                    order tracking, and a personalized trading experience!
                </p>
            </td>
        </tr>
        
        <!-- Footer -->
      
        ${SUPPORT_FOOTER}
    </table>
</body>
</html>
    `;
};
const forgotPasswordMail = (firstName, resetPasswordToken) => {
  const date = getDatTimeUTC();
  return `
        <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - Finstack</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
        <!-- Header -->
        <tr>
            <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack</h1>
                <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 14px;">Secure Your Account</p>
            </td>
        </tr>
        
        <!-- Main Content -->
        <tr>
            <td style="background-color: #ffffff; padding: 30px;">
                <h2 style="color: #2F67FA; margin: 0 0 20px 0;">Reset Your Password</h2>
                <p style="line-height: 1.6; margin: 0 0 20px 0;">
                    Hello ${firstName},<br><br>
                    We received a request to reset your Finstack account password on 
                    <strong>${date}</strong>. Click the button below to verify and set a new password:
                </p>
                
                <!-- Reset Password Button -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 20px;">
                    <tr>
                        <td style="background-color: #2F67FA; border-radius: 5px;">
                            <a href="${
                              process.env.FRONTEND_URL
                            }/reset-password?token=${resetPasswordToken}" 
                               style="display: inline-block; padding: 14px 35px; color: #ffffff; 
                                      text-decoration: none; font-weight: bold; font-size: 16px;">
                                Reset Password
                            </a>
                        </td>
                    </tr>
                </table>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0; font-size: 14px;">
                    Or copy and paste this link into your browser:<br>
                    <a href="${
                      process.env.FRONTEND_URL
                    }/reset-password?token=${resetPasswordToken}" style="color: #2F67FA; word-break: break-all;">${
                      process.env.FRONTEND_URL
                    }/reset-password?token=${resetPasswordToken}</a>
                </p>
                
                <p style="line-height: 1.6; margin: 0; color: #666; font-size: 12px;">
                    This link expires in 1 hour. If you didn’t request a password reset, 
                    please ignore this email or contact support immediately.
                </p>
            </td>
        </tr>
        
        <!-- Security Tip -->
        <tr>
            <td style="background-color: #fff5f0; padding: 20px; font-size: 14px;">
                <p style="margin: 0; line-height: 1.6;">
                    <strong style="color: #2F67FA;">Tip:</strong> Choose a strong, unique password 
                    to keep your Finstack account secure.
                </p>
            </td>
        </tr>
        
        <!-- Footer -->
            
        ${SUPPORT_FOOTER}
    </table>
</body>
</html>
    `;
};
const generatePasswordResetMail = (firstName) => {
  const date = getDatTimeUTC();
  return `
        <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Changed - Finstack</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
    <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
        <!-- Header -->
        <tr>
            <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack</h1>
                <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 14px;">Your Account is Secure</p>
            </td>
        </tr>
        
        <!-- Main Content -->
        <tr>
            <td style="background-color: #ffffff; padding: 30px; text-align: center;">
                <h2 style="color: #2F67FA; margin: 0 0 20px 0;">Password Changed Successfully!</h2>
                
                <!-- Success Icon -->
                <div style="font-size: 48px; margin: 20px 0;">🔒</div>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0;">
                    Hello ${firstName},<br><br>
                    Great news! Your Finstack account password was successfully updated 
                    on ${date}. You’re all set to continue trading with enhanced security.
                </p>
                
                <!-- Login Button -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px auto;">
                    <tr>
                        <td style="background-color: #2F67FA; border-radius: 5px;">
                            <a href="${process.env.FRONTEND_URL}" 
                               style="display: inline-block; padding: 14px 35px; color: #ffffff; 
                                      text-decoration: none; font-weight: bold; font-size: 16px;">
                                Log In Now
                            </a>
                        </td>
                    </tr>
                </table>
                
                <p style="line-height: 1.6; margin: 0 0 20px 0; font-size: 14px; color: #666;">
                    If you didn’t make this change, please contact us immediately.
                </p>
            </td>
        </tr>
        
        <!-- Security Tip -->
        <tr>
            <td style="background-color: #fff5f0; padding: 20px; font-size: 14px;">
                <p style="margin: 0; line-height: 1.6;">
                    <strong style="color: #2F67FA;">Security Tip:</strong> Keep your account safe 
                    by using a unique password and never sharing it with anyone.
                </p>
            </td>
        </tr>
        
        <!-- Footer -->
         ${SUPPORT_FOOTER}
    </table>
</body>
</html>
    `;
};

const generateAnnouncementMail = (title, body, firstName = "User") => {
  // Reusing the existing email structure (Header, Footer, styles) for consistency
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Announcement: ${title}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5; color: #333;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin: 20px auto;">
            <tr>
                <td style="background-color: #2F67FA; padding: 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Finstack Announcement</h1>
                </td>
            </tr>
            
            <tr>
                <td style="background-color: #ffffff; padding: 30px;">
                    <h2 style="color: #2F67FA; margin: 0 0 20px 0; font-size: 24px;">${title}</h2>
                    
                    <p style="line-height: 1.6; margin: 0 0 20px 0; font-size: 16px;">
                        Hello ${firstName || "User"},
                    </p>
                    
                    <div style="line-height: 1.6; margin: 0 0 20px 0; font-size: 16px; border-left: 4px solid #2F67FA; padding-left: 15px;">
                        ${body}
                    </div>

                    <p style="line-height: 1.6; margin: 0 0 20px 0; font-size: 14px; color: #666;">
                        Thank you for being a part of the Finstack community.
                    </p>
                </td>
            </tr>
            
             ${SUPPORT_FOOTER}
        </table>
    </body>
    </html>
    `;
};

const escapeHtml = (str = "") =>
  String(str).replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );

const generateTradeAlertMail = ({
  firstName,
  amount,
  currency,
  reference,
  side,
}) => {
  const tradeType =
    side === "BUY" ? "buy crypto from you" : "sell crypto to you";

  const safeName = escapeHtml(firstName);
  const safeRef = escapeHtml(reference);

  return {
    subject: `New P2P Trade Request – ${safeRef}`,
    text: `Hello ${safeName},
A new P2P trade has been initiated.

Action: User wants to ${tradeType}
Amount: ${amount} ${currency}
Trade Ref: ${safeRef}

Login to process this trade.`,

    html: `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif;">
  <h2>New P2P Trade</h2>
  <p>Hello ${safeName},</p>

  <p>A new trade has been initiated.</p>

  <ul>
    <li><strong>Action:</strong> ${tradeType}</li>
    <li><strong>Amount:</strong> ${amount} ${currency}</li>
    <li><strong>Trade Ref:</strong> ${safeRef}</li>
  </ul>

  <p>
    <a href="${process.env.FRONTEND_URL}/trades/${safeRef}">
      View Trade
    </a>
  </p>

  <p>Please stay online until the trade is completed.</p>
</body>
</html>
`,
  };
};

const generateBuyerPaidMail = ({ firstName, reference, amount }) => ({
  subject: "Buyer marked payment as sent",
  html: `<p>Hello ${firstName},</p>
         <p>The buyer has marked payment as sent.</p>
         <p><strong>Amount:</strong> ${amount}</p>
         <p><strong>Trade Ref:</strong> ${reference}</p>
         <p>Please verify that payment has been received.</p>`,
  text: `Buyer marked payment as sent. Ref: ${reference}`,
});

// Inside mailGenerator.js
const generateMerchantPaidMail = ({
  firstName,
  reference,
  amount,
  currency,
}) => ({
  subject: "Merchant has marked payment as sent",
  html: `
    <p>Hello ${firstName},</p>
    <p>The merchant has marked your P2P trade as <strong>Paid</strong>.</p>
    <p><strong>Amount to receive:</strong> ${amount} ${currency}</p>
    <p><strong>Trade Ref:</strong> ${reference}</p>
    <p>Please check your bank account. Once confirmed, log in to release the crypto assets.</p>
  `,
  text: `Hello ${firstName}, the merchant has marked trade ${reference} as paid. Please verify the receipt of ${amount} ${currency}.`,
});

const generateAdminResolutionMail = ({
  firstName,
  reference,
  outcome, // "RELEASED" | "CANCELLED"
  role, // "buyer" | "merchant"
}) => {
  const actionText =
    outcome === "RELEASED"
      ? "has been completed and crypto has been released"
      : "has been cancelled and funds have been reversed";

  return {
    subject: `P2P Trade ${reference} — Admin Resolution`,
    text: `Hello ${firstName},
Your P2P trade (${reference}) ${actionText} following an admin review.

If you have questions, please contact support.`,
    html: `
      <p>Hello ${firstName},</p>
      <p>
        Your P2P trade <strong>${reference}</strong>
        ${actionText} following an <strong>admin dispute resolution</strong>.
      </p>
      <p>
        If you have any questions, please contact support.
      </p>
    `,
  };
};

module.exports = {
  generateNewUserMail,
  generateVerificationSuccessMail,
  generateVerificationRequest,
  forgotPasswordMail,
  generatePasswordResetMail,
  generateAnnouncementMail,
  generateTradeAlertMail,
  generateBuyerPaidMail,
  generateMerchantPaidMail,
  generateAdminResolutionMail,
};
