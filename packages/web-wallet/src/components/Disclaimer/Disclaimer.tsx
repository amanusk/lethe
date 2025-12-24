import React, { useState } from 'react';
import { LetheLogoPNG } from '../../assets';

interface DisclaimerProps {
  onAccept: () => void;
}

const Disclaimer: React.FC<DisclaimerProps> = ({ onAccept }) => {
  const [isAccepted, setIsAccepted] = useState(false);

  const handleContinue = () => {
    if (isAccepted) {
      localStorage.setItem('disclaimer-accepted', 'true');
      onAccept();
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 py-8">
      <div className="max-w-4xl w-full">
        <div className="flex items-center mb-8">
          <img src={LetheLogoPNG} className="h-16 mr-4" alt="lethe Logo" />
          <h1 className="font-inter font-semibold text-4xl text-white">lethe</h1>
        </div>
        
        <div className="bg-[#1a1a1a] border border-gray-800 rounded-xl p-8 space-y-6">
          <h2 className="font-inter font-semibold text-2xl text-white">Disclaimer</h2>
          
          <div className="space-y-4 text-gray-300 font-inter leading-relaxed">
            <p>
              This application ("the App") is provided as a Proof of Concept and beta software for experimental and demonstration purposes only. The App is provided "as is" and "as available," without warranties of any kind, express or implied.
            </p>
            
            <div>
              <h3 className="font-semibold text-white mb-2">No Liability for Loss of Funds</h3>
              <p>
                By using the App, you acknowledge and agree that the developers, contributors, and maintainers assume no responsibility or liability for any loss of funds, assets, data, or other damages, whether direct or indirect. Use of the App is entirely at your own risk and discretion.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-white mb-2">Regulatory and Legal Considerations</h3>
              <p>
                The App utilizes shielded Zcash transactions. Such transactions may be restricted, regulated, or prohibited in certain jurisdictions. You are solely responsible for determining whether your use of the App complies with applicable laws and regulations in your jurisdiction.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-white mb-2">Embedded and Ephemeral Wallet</h3>
              <p>
                The App creates an embedded wallet within your browser and relies on browser-based storage. This wallet is ephemeral by design and may be lost due to browser actions such as clearing storage, using private/incognito modes, browser updates, or device changes.
              </p>
              <p className="mt-2">
                Do not use this App to store funds long term. The App is not intended to function as a secure or persistent wallet solution.
              </p>
            </div>
            
            <div>
              <h3 className="font-semibold text-white mb-2">User Responsibility</h3>
              <p>
                By accessing or using the App, you confirm that you understand and accept these risks and limitations, and that you are solely responsible for safeguarding your funds and ensuring compliance with applicable laws.
              </p>
            </div>
          </div>
          
          <div className="flex items-start space-x-3 pt-4 border-t border-gray-800">
            <input
              type="checkbox"
              id="disclaimer-checkbox"
              checked={isAccepted}
              onChange={(e) => setIsAccepted(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-gray-600 bg-gray-700 text-yellow-500 focus:ring-yellow-500 focus:ring-2 cursor-pointer"
            />
            <label
              htmlFor="disclaimer-checkbox"
              className="text-gray-300 font-inter cursor-pointer select-none"
            >
              I have read the disclaimer and acknowledge the risks
            </label>
          </div>
          
          <button
            onClick={handleContinue}
            disabled={!isAccepted}
            className={`w-full py-3 px-6 rounded-[2rem] font-inter font-medium transition-all ${
              isAccepted
                ? 'bg-button-black-gradient hover:bg-button-black-gradient-hover text-white cursor-pointer'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            Continue to lethe
          </button>
        </div>
      </div>
    </div>
  );
};

export default Disclaimer;

