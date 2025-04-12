import React, { useState } from 'react';
import '../styles/Onboarding.css';
import { useCreateWorkspace } from '@/hooks/useWorkspaces';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [workspaceName, setWorkspaceName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { mutateAsync: createWorkspace } = useCreateWorkspace();

  const handleNext = () => {
    if (step < 2) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };


  return (
    <div className="onboarding-container">
      <div className="onboarding-card">
        <div className="onboarding-header">
          <h1>Welcome to Horizon</h1>
          <p>Let's get you set up in just a few steps</p>
        </div>

        <div className="onboarding-content">
          {step === 1 && (
            <div className="onboarding-step">
              <h2>Welcome to Your Workspace</h2>
              <p>
                Horizon is your personal knowledge workspace. Create notes,
                organize your thoughts, and access everything from anywhere.
              </p>
              <div className="onboarding-image">
                {/* Placeholder for welcome image */}
                <div className="image-placeholder">
                  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                  </svg>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-step">
              <h2>Create Your First Workspace</h2>
              <p>
                A workspace helps you organize your knowledge. What would you like
                to name your first workspace?
              </p>
              <div className="input-group">
                <label htmlFor="workspace-name">Workspace Name</label>
                <input
                  id="workspace-name"
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="e.g., Work, Personal, Research"
                  className="onboarding-input"
                />
                {error && <div className="error-message">{error}</div>}
              </div>
            </div>
          )}

          <div className="onboarding-actions">
            {step > 1 && (
              <button
                className="onboarding-back-button"
                onClick={handleBack}
                disabled={isLoading}
              >
                Back
              </button>
            )}
            
            {step < 2 ? (
              <button
                className="onboarding-next-button"
                onClick={handleNext}
                disabled={isLoading}
              >
                Next
              </button>
            ) : (
              <button
                className="onboarding-complete-button"
                onClick={() => createWorkspace(workspaceName)}
                disabled={isLoading}
              >
                {isLoading ? 'Creating...' : 'Create Workspace'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;