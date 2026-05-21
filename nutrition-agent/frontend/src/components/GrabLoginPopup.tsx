import React, { useState } from 'react';

interface GrabLoginPopupProps {
  userId: string;
  onLoginSuccess: () => void;
}

export function GrabLoginPopup({ userId, onLoginSuccess }: GrabLoginPopupProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const openGrabLogin = () => {
    // Open Grab login in a popup window
    const width = 600;
    const height = 800;
    const left = window.innerWidth / 2 - width / 2;
    const top = window.innerHeight / 2 - height / 2;

    const popupWindow = window.open(
      'https://food.grab.com/sg/en/login',
      'grab_login',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Check if user closed popup
    let checkInterval = setInterval(() => {
      if (popupWindow?.closed) {
        clearInterval(checkInterval);
        
        // Assume user logged in if they closed popup
        // (In production, you'd verify this with backend)
        setIsLoggedIn(true);
        setShowPopup(false);
        onLoginSuccess();
      }
    }, 1000);

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(checkInterval);
      popupWindow?.close();
    }, 10 * 60 * 1000);
  };

  if (isLoggedIn) {
    return (
      <div className="grab-login-status">
        <div className="status-message">
          <span style={{ color: '#10b981', fontSize: '16px' }}>
            ✓ Logged in to Grab
          </span>
          <p style={{ color: '#94a3b8', fontSize: '12px', margin: '4px 0 0 0' }}>
            Your session is active. You can now search for meals.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grab-login-section">
      <div className="login-card">
        <h2>🍽️ Connect to Grab Food</h2>
        
        <p className="description">
          We need to access Grab Food to search for meals in your area.
        </p>

        <div className="security-note">
          <p style={{ fontSize: '12px', color: '#cbd5e1', margin: 0 }}>
            <strong>🔐 Privacy & Security:</strong>
          </p>
          <ul style={{ fontSize: '12px', color: '#cbd5e1', margin: '8px 0', paddingLeft: '20px' }}>
            <li>You log in directly to Grab (we don't see your password)</li>
            <li>Your session stays in your browser</li>
            <li>We only use it to search for meals</li>
            <li>Your credentials are never sent to our servers</li>
          </ul>
        </div>

        <button 
          onClick={openGrabLogin}
          className="grab-login-btn"
        >
          Click here to login to Grab
        </button>

        <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', marginTop: '12px' }}>
          A popup window will open. Login with your Grab account.
          Once done, close the popup and come back here.
        </p>
      </div>
    </div>
  );
}

export default GrabLoginPopup;