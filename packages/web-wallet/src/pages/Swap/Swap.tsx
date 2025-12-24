import React, { useEffect, useState, useRef } from 'react';
import { useWebZjsActions } from '../../hooks';
import { usePczt, PcztTransferStatus } from '../../hooks/usePCZT';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useStarknetWallet } from '../../context/StarknetWalletContext';
import useBalance from '../../hooks/useBalance';
import { zatsToZec, zecToZats, strkToSmallestUnit } from '../../utils';
import { getQuote, QuoteResponse, submitTxHash, getExecutionStatus } from '../../services/nearIntents';
import PageHeading from '../../components/PageHeading/PageHeading';
import Loader from '../../components/Loader/Loader';
import Input from '../../components/Input/Input';
import Button from '../../components/Button/Button';
import TransactionStatusCard from '../../components/TransactionStatusCard/TransactionStatusCard';
import { CheckSVG, WarningSVG } from '../../assets';
import { useInterval } from 'usehooks-ts';
import type { StarknetWindowObject } from '@starknet-io/get-starknet-core';

// Transaction fee in zatoshis (0.00015 ZEC)
const TRANSACTION_FEE_ZATOSHIS = 15000;

// Minimum STRK amount for swaps
const MIN_STRK_AMOUNT = 40;

// Asset identifiers for Near Intents
const STARKNET_ASSET = 'nep141:starknet.omft.near';
const ZEC_ASSET = 'nep141:zec.omft.near';

// STRK token contract address on Starknet mainnet
const STRK_TOKEN_CONTRACT = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';

enum SwapDirection {
  STRK_TO_ZEC = 'STRK_TO_ZEC',
  ZEC_TO_STRK = 'ZEC_TO_STRK',
}

enum SwapStatus {
  INITIAL = 'initial',
  QUOTE_RECEIVED = 'quote_received',
  WAITING_DEPOSIT = 'waiting_deposit',
  TRANSFERRING = 'transferring',
  WAITING_INTENT = 'waiting_intent',
  INTENT_SUCCESS = 'intent_success',
  COMPLETE = 'complete',
  ERROR = 'error',
}

function Swap(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [swapDirection, setSwapDirection] = useState<SwapDirection>(SwapDirection.STRK_TO_ZEC);
  const [unifiedAddress, setUnifiedAddress] = useState('');
  
  // STRK→ZEC state
  const [strkAmount, setStrkAmount] = useState('');
  const [senderStarknetAddress, setSenderStarknetAddress] = useState('');
  const [strkAmountError, setStrkAmountError] = useState('');
  const [senderStarknetAddressError, setSenderStarknetAddressError] = useState('');
  const [previousBalance, setPreviousBalance] = useState(0);
  const [monitoringActive, setMonitoringActive] = useState(false);
  const transferTriggeredRef = useRef(false);
  const [firstLegTxHash, setFirstLegTxHash] = useState('');
  
  // ZEC→STRK state
  const [zecAmount, setZecAmount] = useState('');
  const [destinationStarknetAddress, setDestinationStarknetAddress] = useState('');
  const [zecAmountError, setZecAmountError] = useState('');
  const [destinationStarknetAddressError, setDestinationStarknetAddressError] = useState('');
  
  // Shared state
  const [status, setStatus] = useState<SwapStatus>(SwapStatus.INITIAL);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [depositAddress, setDepositAddress] = useState('');
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [availableWallets, setAvailableWallets] = useState<StarknetWindowObject[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [intentStatus, setIntentStatus] = useState<any>(null);

  const { getAccountData, triggerRescan } = useWebZjsActions();
  const { handlePcztTransaction, pcztTransferStatus } = usePczt();
  const { state } = useWebZjsContext();
  const { shieldedBalance } = useBalance();
  const {
    walletAccount,
    address: walletAddress,
    isConnected: isWalletConnected,
    connectWallet,
    disconnectWallet,
    getAvailableWalletsList,
    error: walletError,
  } = useStarknetWallet();

  // Calculate sendable amount (balance minus fees)
  const calculateSendableAmount = (balance: number): number => {
    if (balance <= TRANSACTION_FEE_ZATOSHIS) {
      return 0;
    }
    return balance - TRANSACTION_FEE_ZATOSHIS;
  };

  // Check if balance is sufficient for transfer (must be more than fee)
  const isBalanceSufficient = (balance: number): boolean => {
    return balance > TRANSACTION_FEE_ZATOSHIS;
  };

  useEffect(() => {
    const fetchData = async () => {
      const data = await getAccountData();
      if (data) {
        setUnifiedAddress(data.unifiedAddress);
      }
      setLoading(false);
    };
    fetchData();
  }, [getAccountData]);

  // Initialize previous balance when component mounts
  useEffect(() => {
    if (!loading && shieldedBalance !== undefined) {
      setPreviousBalance(shieldedBalance);
    }
  }, [loading, shieldedBalance]);

  // Auto-populate sender address when wallet connects (for STRK→ZEC)
  useEffect(() => {
    if (swapDirection === SwapDirection.STRK_TO_ZEC && isWalletConnected && walletAddress && !senderStarknetAddress) {
      setSenderStarknetAddress(walletAddress);
      validateSenderStarknetAddress(walletAddress);
    }
  }, [isWalletConnected, walletAddress, senderStarknetAddress, swapDirection]);

  // Monitor balance changes for STRK→ZEC flow
  useEffect(() => {
    if (
      !loading &&
      monitoringActive &&
      status === SwapStatus.WAITING_DEPOSIT &&
      swapDirection === SwapDirection.STRK_TO_ZEC
    ) {
      console.log('[Swap] Balance check:', {
        previousBalance: zatsToZec(previousBalance),
        currentBalance: zatsToZec(shieldedBalance),
        difference: zatsToZec(shieldedBalance - previousBalance),
        status,
        transferTriggered: transferTriggeredRef.current,
      });

      // Check if balance increased
      if (shieldedBalance > previousBalance && !transferTriggeredRef.current) {
        const balanceIncrease = shieldedBalance - previousBalance;
        console.log('[Swap] Balance increase detected!', {
          previousBalance: zatsToZec(previousBalance),
          newBalance: zatsToZec(shieldedBalance),
          increase: zatsToZec(balanceIncrease),
        });

        setStatus(SwapStatus.COMPLETE);
        setPreviousBalance(shieldedBalance);
      } else if (
        shieldedBalance !== previousBalance &&
        !transferTriggeredRef.current
      ) {
        setPreviousBalance(shieldedBalance);
      }
    }
  }, [
    shieldedBalance,
    previousBalance,
    loading,
    monitoringActive,
    status,
    swapDirection,
  ]);

  // Periodic rescan to ensure we have latest balance (for STRK→ZEC)
  useInterval(
    async () => {
      if (
        !monitoringActive ||
        status !== SwapStatus.WAITING_DEPOSIT ||
        swapDirection !== SwapDirection.STRK_TO_ZEC
      ) {
        return;
      }

      console.log('[Swap] Periodic rescan...');
      await triggerRescan();
    },
    monitoringActive &&
      status === SwapStatus.WAITING_DEPOSIT &&
      swapDirection === SwapDirection.STRK_TO_ZEC
      ? 10000
      : null,
  );

  // Monitor transfer status for ZEC→STRK flow
  useEffect(() => {
    if (status === SwapStatus.TRANSFERRING && swapDirection === SwapDirection.ZEC_TO_STRK) {
      console.log('[Swap] Transfer status update:', pcztTransferStatus);

      if (pcztTransferStatus === PcztTransferStatus.SENDING_PCZT) {
        console.log('[Swap] Transaction is being sent to the network...');
      } else if (pcztTransferStatus === PcztTransferStatus.SEND_SUCCESSFUL) {
        console.log('[Swap] Transfer marked as successful, waiting for confirmation...');
        const timer = setTimeout(async () => {
          console.log('[Swap] Transfer confirmed complete!');
          
          // Automatically submit transaction hash if we have it and deposit address
          if (transactionHash && quote?.quote?.depositAddress) {
            try {
              console.log('[Swap] Submitting transaction hash...', {
                txHash: transactionHash,
                depositAddress: quote.quote.depositAddress,
              });
              await submitTxHash(transactionHash, quote.quote.depositAddress);
              console.log('[Swap] Transaction hash submitted successfully');
            } catch (error) {
              console.error('[Swap] Error submitting transaction hash:', error);
            }
          }
          
          setStatus(SwapStatus.WAITING_INTENT);
        }, 2000);

        return () => clearTimeout(timer);
      } else if (pcztTransferStatus === PcztTransferStatus.SEND_ERROR) {
        // Don't immediately show error - the transaction might still succeed
        // Check if we already have a transaction hash (indicates success)
        if (transactionHash) {
          console.log('[Swap] Transaction hash found despite SEND_ERROR - transaction likely succeeded');
          // Transaction hash exists, so transaction likely succeeded
          // Transition to WAITING_INTENT if we have deposit address
          if (quote?.quote?.depositAddress) {
            setStatus(SwapStatus.WAITING_INTENT);
          }
        } else {
          // Wait a bit to see if transaction hash appears (transaction might still be processing)
          console.warn('[Swap] SEND_ERROR status detected, waiting to verify actual failure...');
          const errorTimer = setTimeout(() => {
            // Only show error if we still don't have a transaction hash after waiting
            if (!transactionHash) {
              console.error('[Swap] Transfer error confirmed - no transaction hash received');
              setStatus(SwapStatus.ERROR);
            } else {
              console.log('[Swap] Transaction hash found after delay - transaction succeeded');
              if (quote?.quote?.depositAddress) {
                setStatus(SwapStatus.WAITING_INTENT);
              }
            }
          }, 5000); // Wait 5 seconds before showing error

          return () => clearTimeout(errorTimer);
        }
      }
    }
  }, [pcztTransferStatus, status, transactionHash, quote, swapDirection]);

  // Poll intent status when in WAITING_INTENT status (for ZEC→STRK)
  useInterval(
    async () => {
      if (status !== SwapStatus.WAITING_INTENT || swapDirection !== SwapDirection.ZEC_TO_STRK) {
        return;
      }

      if (!quote?.quote?.depositAddress) {
        console.warn('[Swap] Cannot poll status - missing deposit address');
        return;
      }

      try {
        console.log('[Swap] Polling intent status...', {
          depositAddress: quote.quote.depositAddress,
        });

        const statusResponse = await getExecutionStatus(quote.quote.depositAddress);
        const currentStatus = statusResponse.status;

        console.log('[Swap] Intent status:', currentStatus);

        setIntentStatus(statusResponse);

        if (currentStatus === 'SUCCESS') {
          console.log('[Swap] Intent fulfilled successfully!');
          setStatus(SwapStatus.INTENT_SUCCESS);
        } else if (currentStatus === 'REFUNDED') {
          console.log('[Swap] Intent refunded');
          setQuoteError(`Swap failed: ${currentStatus}. Refunded amount: ${statusResponse.swapDetails?.refundedAmountFormatted || '0'}`);
          setStatus(SwapStatus.ERROR);
        }
      } catch (error) {
        console.error('[Swap] Error checking intent status:', error);
      }
    },
    status === SwapStatus.WAITING_INTENT && swapDirection === SwapDirection.ZEC_TO_STRK ? 10000 : null,
  );

  // Handle transaction hash appearing after SEND_ERROR (transaction might have succeeded)
  useEffect(() => {
    if (
      status === SwapStatus.TRANSFERRING &&
      swapDirection === SwapDirection.ZEC_TO_STRK &&
      transactionHash &&
      pcztTransferStatus === PcztTransferStatus.SEND_ERROR
    ) {
      console.log('[Swap] Transaction hash found after SEND_ERROR - treating as success');
      // Transaction hash exists, so transaction likely succeeded despite error status
      if (quote?.quote?.depositAddress) {
        setStatus(SwapStatus.WAITING_INTENT);
      }
    }
  }, [transactionHash, pcztTransferStatus, status, quote, swapDirection]);

  // Monitor console logs to extract transaction hash (for ZEC→STRK)
  useEffect(() => {
    if (status === SwapStatus.TRANSFERRING && swapDirection === SwapDirection.ZEC_TO_STRK) {
      const originalLog = console.log;
      const originalInfo = console.info;

      const extractTxHash = (message: string) => {
        const patterns = [
          /Transaction\s+([a-f0-9]{64})\s+send successfully/i,
          /Transaction\s+([a-f0-9]{64})/i,
          /txid[:\s]+([a-f0-9]{64})/i,
          /transaction[:\s]+([a-f0-9]{64})/i,
        ];

        for (const pattern of patterns) {
          const match = message.match(pattern);
          if (match && match[1] && match[1].length === 64) {
            return match[1];
          }
        }
        return null;
      };

      const logInterceptor = (...args: any[]) => {
        const message = args
          .map((arg) =>
            typeof arg === 'string' ? arg : JSON.stringify(arg),
          )
          .join(' ');
        const txHash = extractTxHash(message);
        if (txHash && !transactionHash) {
          console.log('[Swap] Transaction hash extracted from logs:', txHash);
          setTransactionHash(txHash);
        }
        originalLog.apply(console, args);
      };

      const infoInterceptor = (...args: any[]) => {
        const message = args
          .map((arg) =>
            typeof arg === 'string' ? arg : JSON.stringify(arg),
          )
          .join(' ');
        const txHash = extractTxHash(message);
        if (txHash && !transactionHash) {
          console.log('[Swap] Transaction hash extracted from logs:', txHash);
          setTransactionHash(txHash);
        }
        originalInfo.apply(console, args);
      };

      console.log = logInterceptor;
      console.info = infoInterceptor;

      return () => {
        console.log = originalLog;
        console.info = originalInfo;
      };
    }
  }, [status, transactionHash, swapDirection]);

  // Validation functions
  const validateSenderStarknetAddress = (address: string): boolean => {
    if (!address || address.trim() === '') {
      setSenderStarknetAddressError('Please enter your STARKNET address');
      return false;
    }
    if (address.length < 20) {
      setSenderStarknetAddressError('Invalid STARKNET address format');
      return false;
    }
    setSenderStarknetAddressError('');
    return true;
  };

  const validateStrkAmount = (amount: string): boolean => {
    if (!amount || amount.trim() === '') {
      setStrkAmountError('Please enter an amount');
      return false;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setStrkAmountError('Amount must be a positive number');
      return false;
    }
    if (numAmount < MIN_STRK_AMOUNT) {
      setStrkAmountError(`Minimum swap amount is ${MIN_STRK_AMOUNT} STRK`);
      return false;
    }
    setStrkAmountError('');
    return true;
  };

  const validateDestinationStarknetAddress = (address: string): boolean => {
    if (!address || address.trim() === '') {
      setDestinationStarknetAddressError('Please enter a destination STARKNET address');
      return false;
    }
    if (address.length < 20) {
      setDestinationStarknetAddressError('Invalid STARKNET address format');
      return false;
    }
    setDestinationStarknetAddressError('');
    return true;
  };

  const validateZecAmount = (amount: string): boolean => {
    if (!amount || amount.trim() === '') {
      setZecAmountError('Please enter an amount');
      return false;
    }
    try {
      const zats = zecToZats(amount);
      const zatsNumber = Number(zats);
      if (zatsNumber <= TRANSACTION_FEE_ZATOSHIS) {
        setZecAmountError(`Amount must be greater than ${zatsToZec(TRANSACTION_FEE_ZATOSHIS)} ZEC (fee)`);
        return false;
      }
      if (zatsNumber > shieldedBalance) {
        setZecAmountError('Insufficient balance');
        return false;
      }
      setZecAmountError('');
      return true;
    } catch (error) {
      setZecAmountError(error instanceof Error ? error.message : 'Invalid amount format');
      return false;
    }
  };

  // Handle wallet connection
  const handleConnectWallet = async () => {
    try {
      setLoadingWallets(true);
      const wallets = await getAvailableWalletsList();
      setAvailableWallets(wallets);
      
      if (wallets.length === 0) {
        setQuoteError('No wallets available. Please install a Starknet wallet extension.');
        return;
      }
      
      if (wallets.length === 1) {
        await connectWallet(wallets[0]);
      } else {
        setShowWalletModal(true);
      }
    } catch (error) {
      console.error('[Swap] Error getting wallets:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to get available wallets',
      );
    } finally {
      setLoadingWallets(false);
    }
  };

  // Handle wallet selection from modal
  const handleWalletSelect = async (wallet: StarknetWindowObject) => {
    try {
      setShowWalletModal(false);
      await connectWallet(wallet);
    } catch (error) {
      console.error('[Swap] Error connecting wallet:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to connect wallet',
      );
    }
  };

  // Handle STRK→ZEC swap initiation
  const handleStrkToZecSwap = async () => {
    if (!validateSenderStarknetAddress(senderStarknetAddress)) return;
    if (!validateStrkAmount(strkAmount)) return;
    if (!unifiedAddress) {
      setQuoteError('Wallet address not available');
      return;
    }

    try {
      setQuoteError('');
      const amountInSmallestUnit = strkToSmallestUnit(strkAmount);

      console.log('[Swap] Getting quote (STRK → ZEC)...', {
        amount: amountInSmallestUnit,
        recipient: unifiedAddress,
        sender: senderStarknetAddress,
      });

      const quoteResponse = await getQuote(
        false,
        senderStarknetAddress,
        unifiedAddress,
        STARKNET_ASSET,
        ZEC_ASSET,
        amountInSmallestUnit,
      );

      if (!quoteResponse.quote?.depositAddress) {
        throw new Error('No deposit address in quote response');
      }

      setQuote(quoteResponse);
      setDepositAddress(quoteResponse.quote.depositAddress);
      setStatus(SwapStatus.QUOTE_RECEIVED);
      setPreviousBalance(shieldedBalance);
      console.log('[Swap] Quote received:', quoteResponse);
    } catch (error) {
      console.error('[Swap] Error getting quote:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to get quote',
      );
      setStatus(SwapStatus.ERROR);
    }
  };

  // Handle ZEC→STRK swap initiation
  const handleZecToStrkSwap = async () => {
    if (!validateDestinationStarknetAddress(destinationStarknetAddress)) return;
    if (!validateZecAmount(zecAmount)) return;
    if (!unifiedAddress) {
      setQuoteError('Wallet address not available');
      return;
    }

    try {
      setQuoteError('');
      const zats = zecToZats(zecAmount);
      // Convert to number then string to match ShieldedTransfer format exactly
      // This ensures the string format matches (number.toString() vs BigInt.toString())
      const amountInZats = Number(zats).toString();

      console.log('[Swap] Getting quote (ZEC → STRK)...', {
        amount: amountInZats,
        recipient: destinationStarknetAddress,
        sender: unifiedAddress,
      });

      const quoteResponse = await getQuote(
        false,
        unifiedAddress,
        destinationStarknetAddress,
        ZEC_ASSET,
        STARKNET_ASSET,
        amountInZats,
      );

      if (!quoteResponse.quote?.depositAddress) {
        throw new Error('No deposit address in quote response');
      }

      setQuote(quoteResponse);
      setDepositAddress(quoteResponse.quote.depositAddress);
      setStatus(SwapStatus.QUOTE_RECEIVED);
      console.log('[Swap] Quote received:', quoteResponse);
    } catch (error) {
      console.error('[Swap] Error getting quote:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to get quote',
      );
      setStatus(SwapStatus.ERROR);
    }
  };

  // Send STRK with wallet (STRK→ZEC flow)
  const handleSendWithWallet = async () => {
    if (!walletAccount || !depositAddress || !strkAmount) {
      setQuoteError('Wallet not connected or missing required information');
      return;
    }

    try {
      setQuoteError('');
      const amountInSmallestUnit = strkToSmallestUnit(strkAmount);
      const amountBigInt = BigInt(amountInSmallestUnit);

      console.log('[Swap] Executing transaction with wallet...', {
        depositAddress,
        amount: amountInSmallestUnit,
        tokenContract: STRK_TOKEN_CONTRACT,
      });

      const UINT256_MAX = 2n ** 128n;
      const low = amountBigInt & (UINT256_MAX - 1n);
      const high = amountBigInt >> 128n;

      const calldata = [
        depositAddress,
        low.toString(),
        high.toString(),
      ];

      const response = await walletAccount.execute({
        contractAddress: STRK_TOKEN_CONTRACT,
        entrypoint: 'transfer',
        calldata: calldata,
      });

      const txHash = response.transaction_hash;
      console.log('[Swap] Transaction executed, hash:', txHash);

      try {
        await submitTxHash(txHash, depositAddress);
        console.log('[Swap] Transaction hash submitted to 1-click API');
      } catch (submitError) {
        console.error('[Swap] Error submitting transaction hash:', submitError);
      }

      setFirstLegTxHash(txHash);
      setStatus(SwapStatus.WAITING_DEPOSIT);
      setMonitoringActive(true);
      setPreviousBalance(shieldedBalance);
      transferTriggeredRef.current = false;
    } catch (error) {
      console.error('[Swap] Error executing wallet transaction:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to execute transaction',
      );
      setStatus(SwapStatus.ERROR);
    }
  };

  // Start monitoring for STRK→ZEC flow
  const handleStartMonitoring = () => {
    if (depositAddress) {
      setStatus(SwapStatus.WAITING_DEPOSIT);
      setMonitoringActive(true);
      setPreviousBalance(shieldedBalance);
      transferTriggeredRef.current = false;
    }
  };

  // Execute ZEC→STRK transfer
  const handleExecuteZecToStrkTransfer = async () => {
    if (!quote?.quote?.depositAddress || !zecAmount) {
      setQuoteError('Quote not available. Please get a new quote.');
      setStatus(SwapStatus.ERROR);
      return;
    }

    try {
      const zats = zecToZats(zecAmount);
      const zecAmountString = zatsToZec(Number(zats)).toString();

      console.log('[Swap] Executing transfer', {
        amount: zecAmountString,
        depositAddress: quote.quote.depositAddress,
      });

      transferTriggeredRef.current = true;
      const accountId =
        state.activeAccount !== null && state.activeAccount !== undefined
          ? state.activeAccount
          : 0;

      setTransactionHash(null);
      setStatus(SwapStatus.TRANSFERRING);
      handlePcztTransaction(
        accountId,
        quote.quote.depositAddress,
        zecAmountString,
      );
    } catch (error) {
      console.error('[Swap] Error executing transfer:', error);
      setQuoteError(
        error instanceof Error ? error.message : 'Failed to send transaction',
      );
      setStatus(SwapStatus.ERROR);
      transferTriggeredRef.current = false;
    }
  };

  // Handle max button for ZEC→STRK
  const handleMaxAmount = () => {
    const maxAmount = calculateSendableAmount(shieldedBalance);
    if (maxAmount > 0) {
      setZecAmount(zatsToZec(maxAmount).toString());
      setZecAmountError('');
    }
  };

  // Reset form
  const handleReset = () => {
    setStatus(SwapStatus.INITIAL);
    setStrkAmount('');
    setZecAmount('');
    setSenderStarknetAddress('');
    setDestinationStarknetAddress('');
    setQuote(null);
    setDepositAddress('');
    setTransactionHash(null);
    setFirstLegTxHash('');
    setQuoteError('');
    setIntentStatus(null);
    setMonitoringActive(false);
    setPreviousBalance(shieldedBalance);
    transferTriggeredRef.current = false;
  };

  // Handle direction change
  const handleDirectionChange = (direction: SwapDirection) => {
    setSwapDirection(direction);
    handleReset();
  };

  // Input handlers
  const handleStrkAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setStrkAmount(value);
    if (value) {
      validateStrkAmount(value);
    } else {
      setStrkAmountError('');
    }
  };

  const handleZecAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setZecAmount(value);
    if (value) {
      validateZecAmount(value);
    } else {
      setZecAmountError('');
    }
  };

  const handleSenderStarknetAddressChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    setSenderStarknetAddress(value);
    if (value) {
      validateSenderStarknetAddress(value);
    } else {
      setSenderStarknetAddressError('');
    }
  };

  const handleDestinationStarknetAddressChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = e.target.value;
    setDestinationStarknetAddress(value);
    if (value) {
      validateDestinationStarknetAddress(value);
    } else {
      setDestinationStarknetAddressError('');
    }
  };

  if (loading) {
    return (
      <>
        <PageHeading title="Swap" />
        <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
          <Loader />
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col w-full">
      <PageHeading title="Swap" />

      {/* Direction Selector */}
      <div className="max-w-[1000px] mb-6 mx-auto">
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => {
              if (status === SwapStatus.INITIAL) {
                handleDirectionChange(SwapDirection.STRK_TO_ZEC);
              }
            }}
            disabled={status !== SwapStatus.INITIAL}
            className={swapDirection === SwapDirection.STRK_TO_ZEC
              ? 'px-6 py-3 bg-gray-800 text-white font-semibold rounded-3xl border border-orange-500 disabled:opacity-50 disabled:cursor-not-allowed'
              : 'px-6 py-3 bg-gray-900 text-gray-400 font-semibold rounded-3xl border border-gray-700 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            STRK → ZEC
          </button>
          <button
            onClick={() => {
              if (status === SwapStatus.INITIAL) {
                handleDirectionChange(SwapDirection.ZEC_TO_STRK);
              }
            }}
            disabled={status !== SwapStatus.INITIAL}
            className={swapDirection === SwapDirection.ZEC_TO_STRK
              ? 'px-6 py-3 bg-gray-800 text-white font-semibold rounded-3xl border border-orange-500 disabled:opacity-50 disabled:cursor-not-allowed'
              : 'px-6 py-3 bg-gray-900 text-gray-400 font-semibold rounded-3xl border border-gray-700 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            ZEC → STRK
          </button>
        </div>
      </div>

      {/* STRK→ZEC Flow */}
      {swapDirection === SwapDirection.STRK_TO_ZEC && (
        <>
          {status === SwapStatus.INITIAL && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <div className="self-stretch flex-col justify-start items-center gap-6 flex">
                <div className="text-white text-lg font-medium font-['Roboto'] leading-normal">
                  Swap STRK to ZEC
                </div>
                <div className="self-stretch flex-col justify-start items-start gap-2 inline-flex">
                  <div className="self-stretch flex items-start justify-between gap-4">
                    <div className={isWalletConnected ? 'flex-1' : 'flex-1'}>
                      <Input
                        label="Your STARKNET Address (Sender/Refund):"
                        id="sender-starknet-address"
                        placeholder="0x..."
                        value={senderStarknetAddress}
                        onChange={handleSenderStarknetAddressChange}
                        error={senderStarknetAddressError}
                        disabled={isWalletConnected}
                      />
                    </div>
                    <div className="flex flex-col gap-2 mt-6">
                      {!isWalletConnected ? (
                        <Button
                          onClick={handleConnectWallet}
                          label={loadingWallets ? 'Loading...' : 'Connect Wallet'}
                          variant="secondary"
                          classNames="min-w-[150px]"
                        />
                      ) : (
                        <>
                          <div className="text-xs text-gray-400 mb-1">
                            Connected: {walletAddress?.substring(0, 10)}...
                          </div>
                          <Button
                            onClick={disconnectWallet}
                            label="Disconnect"
                            variant="secondary"
                            classNames="min-w-[150px] text-xs"
                          />
                        </>
                      )}
                    </div>
                  </div>
                  {walletError && (
                    <div className="text-red-400 text-sm font-normal font-['Roboto']">
                      {walletError.message}
                    </div>
                  )}
                </div>
                <div className="self-stretch flex-col justify-start items-start gap-2 inline-flex">
                  <Input
                    label="STRK Amount:"
                    id="strk-amount"
                    placeholder="0.0"
                    type="number"
                    step="0.000000000000000001"
                    min="0"
                    value={strkAmount}
                    onChange={handleStrkAmountChange}
                    error={strkAmountError}
                    suffix="STRK"
                  />
                </div>
                {quoteError && (
                  <div className="text-red-400 text-sm font-normal font-['Roboto']">
                    {quoteError}
                  </div>
                )}
                <Button
                  onClick={handleStrkToZecSwap}
                  label="Get Quote"
                  disabled={
                    !senderStarknetAddress ||
                    !strkAmount ||
                    !!senderStarknetAddressError ||
                    !!strkAmountError ||
                    (strkAmount && parseFloat(strkAmount) < MIN_STRK_AMOUNT)
                  }
                />
              </div>
            </div>
          )}

          {status === SwapStatus.QUOTE_RECEIVED && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Quote Received"
                statusMessage={`Send ${strkAmount} STRK to the address below:`}
                icon={<CheckSVG />}
              >
                <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                  <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                    STARKNET Deposit Address:
                  </div>
                  <div className="text-white text-sm font-mono break-all">
                    {depositAddress}
                  </div>
                </div>
                <div className="text-gray-400 text-sm font-normal font-['Roboto'] mt-2">
                  Amount to send: {strkAmount} STRK
                </div>
                <div className="flex flex-col gap-3 w-full">
                  {isWalletConnected && walletAccount ? (
                    <Button
                      onClick={handleSendWithWallet}
                      label="Send with Wallet"
                      disabled={!depositAddress || !strkAmount}
                    />
                  ) : null}
                  <Button
                    onClick={handleStartMonitoring}
                    label="Start Monitoring"
                    variant={isWalletConnected ? 'secondary' : 'primary'}
                  />
                </div>
              </TransactionStatusCard>
            </div>
          )}

          {status === SwapStatus.WAITING_DEPOSIT && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Waiting for Deposit"
                statusMessage="Monitoring for incoming ZEC transactions..."
                icon={<Loader />}
              >
                <div className="text-gray-400 text-sm font-normal font-['Roboto'] mt-2">
                  Current balance: {zatsToZec(shieldedBalance)} ZEC
                </div>
                <div className="text-gray-400 text-xs font-normal font-['Roboto'] mt-1">
                  Send {strkAmount} STRK to: {depositAddress.substring(0, 20)}...
                </div>
                {firstLegTxHash && (
                  <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                    <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                      Transaction Hash:
                    </div>
                    <div className="text-white text-sm font-mono break-all">
                      {firstLegTxHash}
                    </div>
                  </div>
                )}
                <Button onClick={handleReset} label="Cancel" variant="secondary" />
              </TransactionStatusCard>
            </div>
          )}

          {status === SwapStatus.COMPLETE && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Swap Complete"
                statusMessage={`Successfully received ${zatsToZec(shieldedBalance)} ZEC`}
                icon={<CheckSVG />}
              >
                <Button onClick={handleReset} label="Start Over" variant="secondary" />
              </TransactionStatusCard>
            </div>
          )}
        </>
      )}

      {/* ZEC→STRK Flow */}
      {swapDirection === SwapDirection.ZEC_TO_STRK && (
        <>
          {status === SwapStatus.INITIAL && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <div className="self-stretch flex-col justify-start items-center gap-6 flex">
                <div className="text-white text-lg font-medium font-['Roboto'] leading-normal">
                  Swap ZEC to STRK
                </div>
                <div className="self-stretch flex-col justify-start items-start gap-2 inline-flex">
                  <Input
                    label="Destination STARKNET Address:"
                    id="destination-starknet-address"
                    placeholder="0x..."
                    value={destinationStarknetAddress}
                    onChange={handleDestinationStarknetAddressChange}
                    error={destinationStarknetAddressError}
                  />
                </div>
                <div className="self-stretch flex-col justify-start items-start gap-2 inline-flex">
                  <div className="self-stretch flex items-center gap-2">
                    <div className="flex-1">
                      <Input
                        label="ZEC Amount:"
                        id="zec-amount"
                        placeholder="0.0"
                        type="number"
                        step="0.00000001"
                        min="0"
                        value={zecAmount}
                        onChange={handleZecAmountChange}
                        error={zecAmountError}
                        suffix="ZEC"
                      />
                    </div>
                    <Button
                      onClick={handleMaxAmount}
                      label="Max"
                      variant="secondary"
                      classNames="mt-6"
                      disabled={!isBalanceSufficient(shieldedBalance)}
                    />
                  </div>
                  <div className="text-gray-400 text-xs font-normal font-['Roboto']">
                    Available: {zatsToZec(shieldedBalance)} ZEC (Fee: {zatsToZec(TRANSACTION_FEE_ZATOSHIS)} ZEC)
                  </div>
                </div>
                {quoteError && (
                  <div className="text-red-400 text-sm font-normal font-['Roboto']">
                    {quoteError}
                  </div>
                )}
                <Button
                  onClick={handleZecToStrkSwap}
                  label="Get Quote"
                  disabled={
                    !destinationStarknetAddress ||
                    !zecAmount ||
                    !!destinationStarknetAddressError ||
                    !!zecAmountError ||
                    !isBalanceSufficient(shieldedBalance)
                  }
                />
              </div>
            </div>
          )}

          {status === SwapStatus.QUOTE_RECEIVED && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Quote Received"
                statusMessage={`Ready to send ${zecAmount} ZEC`}
                icon={<CheckSVG />}
              >
                {quote?.quote?.depositAddress && (
                  <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                    <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                      Zcash Deposit Address:
                    </div>
                    <div className="text-white text-sm font-mono break-all">
                      {quote.quote.depositAddress}
                    </div>
                  </div>
                )}
                <div className="text-gray-400 text-sm font-normal font-['Roboto'] mt-2">
                  Will send: {zecAmount} ZEC (Fee: {zatsToZec(TRANSACTION_FEE_ZATOSHIS)} ZEC)
                </div>
                <div className="text-gray-400 text-xs font-normal font-['Roboto'] mt-1">
                  To: {destinationStarknetAddress}
                </div>
                <Button onClick={handleExecuteZecToStrkTransfer} label="Execute Swap" />
              </TransactionStatusCard>
            </div>
          )}

          {status === SwapStatus.TRANSFERRING && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText={
                  pcztTransferStatus === PcztTransferStatus.SENDING_PCZT
                    ? 'Sending transaction'
                    : 'Transferring funds'
                }
                statusMessage={
                  pcztTransferStatus === PcztTransferStatus.SENDING_PCZT
                    ? `Sending ${zecAmount} ZEC transaction to the network...`
                    : `${pcztTransferStatus}`
                }
                icon={<Loader />}
              >
                {quote?.quote?.depositAddress && (
                  <div className="text-gray-400 text-sm font-normal font-['Roboto'] mt-2 break-all">
                    To: {quote.quote.depositAddress}
                  </div>
                )}
                <div className="text-gray-400 text-xs font-normal font-['Roboto'] mt-1">
                  (Transaction fee: {zatsToZec(TRANSACTION_FEE_ZATOSHIS)} ZEC)
                </div>
              </TransactionStatusCard>
            </div>
          )}

          {status === SwapStatus.WAITING_INTENT && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Waiting for Intent"
                statusMessage="Waiting for Near Intent to complete and transfer to Starknet..."
                icon={<Loader />}
              >
                {transactionHash && (
                  <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                    <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                      Transaction Hash:
                    </div>
                    <div className="text-white text-sm font-mono break-all">
                      {transactionHash}
                    </div>
                  </div>
                )}
                {quote?.quote?.depositAddress && (
                  <div className="mt-4 w-full flex flex-col gap-2">
                    <a
                      href={`https://explorer.near-intents.org/transactions/${quote.quote.depositAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm font-normal font-['Roboto'] underline"
                    >
                      View on Near Intents Explorer
                    </a>
                    <div className="text-gray-400 text-xs font-normal font-['Roboto'] mt-2">
                      Checking status every 10 seconds...
                    </div>
                  </div>
                )}
                {intentStatus && (
                  <div className="mt-4 text-gray-400 text-sm font-normal font-['Roboto']">
                    Current status: {intentStatus.status}
                  </div>
                )}
              </TransactionStatusCard>
            </div>
          )}

          {status === SwapStatus.INTENT_SUCCESS && (
            <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
              <TransactionStatusCard
                headText="Swap Complete"
                statusMessage={
                  intentStatus?.swapDetails?.amountOutFormatted
                    ? `Successfully transferred ${intentStatus.swapDetails.amountOutFormatted} STRK to ${destinationStarknetAddress.substring(0, 20)}...`
                    : quote?.quote?.amountOutFormatted
                      ? `Successfully transferred ${quote.quote.amountOutFormatted} STRK to ${destinationStarknetAddress.substring(0, 20)}...`
                      : 'Intent fulfilled successfully!'
                }
                icon={<CheckSVG />}
              >
                {intentStatus?.swapDetails?.amountOutFormatted && (
                  <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                    <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                      Amount Transferred:
                    </div>
                    <div className="text-white text-lg font-medium font-['Roboto']">
                      {intentStatus.swapDetails.amountOutFormatted} STRK
                    </div>
                    {intentStatus.swapDetails.amountOutUsd && (
                      <div className="text-gray-400 text-xs font-normal font-['Roboto'] mt-1">
                        ≈ ${intentStatus.swapDetails.amountOutUsd} USD
                      </div>
                    )}
                  </div>
                )}
                {quote?.quote?.depositAddress && (
                  <div className="mt-4 w-full">
                    <a
                      href={`https://explorer.near-intents.org/transactions/${quote.quote.depositAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm font-normal font-['Roboto'] underline"
                    >
                      View on Near Intents Explorer
                    </a>
                  </div>
                )}
                {transactionHash && (
                  <div className="mt-4 p-3 bg-gray-800 rounded-xl border border-gray-700 w-full">
                    <div className="text-gray-400 text-sm font-normal font-['Roboto'] mb-2">
                      Transaction Hash:
                    </div>
                    <div className="text-white text-sm font-mono break-all">
                      {transactionHash}
                    </div>
                  </div>
                )}
                <Button onClick={handleReset} label="Start Over" variant="secondary" />
              </TransactionStatusCard>
            </div>
          )}
        </>
      )}

      {/* Error State */}
      {status === SwapStatus.ERROR && (
        <div className="max-w-[1000px] p-9 bg-gray-900 rounded-3xl border border-gray-700 flex-col justify-start items-center gap-9 inline-flex">
          <TransactionStatusCard
            headText="Error"
            statusMessage={
              quoteError || 'An error occurred. Please try again.'
            }
            icon={<WarningSVG />}
          >
            <Button onClick={handleReset} label="Try Again" variant="primary" />
          </TransactionStatusCard>
        </div>
      )}

      {/* Wallet Selection Modal */}
      {showWalletModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
          onClick={() => setShowWalletModal(false)}
        >
          <div
            className="bg-gray-900 rounded-3xl p-6 max-w-md w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-white text-xl font-medium font-['Roboto']">
                Select a Wallet
              </h2>
              <button
                onClick={() => setShowWalletModal(false)}
                className="text-gray-400 text-2xl hover:text-white transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto">
              {availableWallets.map((wallet, index) => (
                <button
                  key={index}
                  onClick={() => handleWalletSelect(wallet)}
                  className="w-full bg-gray-800 border-2 border-gray-700 rounded-xl p-4 text-left hover:border-gray-600 hover:bg-gray-750 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-gray-700">
                      {wallet.icon ? (
                        <img
                          src={
                            typeof wallet.icon === 'string'
                              ? wallet.icon
                              : wallet.icon.light || wallet.icon.dark
                          }
                          alt={wallet.name || 'Wallet'}
                          className="w-8 h-8"
                        />
                      ) : (
                        <div className="text-2xl">🔷</div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <div className="text-white text-base font-medium font-['Roboto']">
                        {wallet.name || 'Unknown Wallet'}
                      </div>
                      <div className="text-gray-400 text-sm font-normal font-['Roboto']">
                        {wallet.id || 'Unknown ID'}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Swap;

