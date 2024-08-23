/* global chrome */
// @ts-nocheck until this file is migrated to TypeScript

import { db } from './db';

console.log('Orbital Wallet Background Script Running!');

const getExchangeRate = async () => {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['exchangeRateCache'], async ({ exchangeRateCache }) => {
      try {
        if (exchangeRateCache?.rate && Date.now() - exchangeRateCache.timestamp < 10 * 60 * 1000) {
          resolve(Number(exchangeRateCache.rate));
        } else {
          const res = await fetch('https://api.coinpaprika.com/v1/coins/rxd-radiant/ohlcv/today');
          const obj = await res.json();
          const rate = obj[0]?.close || 0;
          const currentTime = Date.now();
          chrome.storage.local.set({ exchangeRateCache: { rate, timestamp: currentTime } });
          resolve(rate);
        }
      } catch (error) {
        console.log(error);
        reject(error);
      }
    });
  });
};

let responseCallbackForConnectRequest;
let responseCallbackForSendRxdRequest;
let responseCallbackForTransferTokenRequest;
let responseCallbackForSignMessageRequest;
let responseCallbackForBroadcastRequest;
let responseCallbackForGetSignaturesRequest;
let responseCallbackForEncryptRequest;
let responseCallbackForDecryptRequest;
let popupWindowId: number | undefined | null = null;

const INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 minutes

const launchPopUp = () => {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL('index.html'),
      type: 'popup',
      width: 360,
      height: 567,
    },
    (window) => {
      popupWindowId = window?.id;
      chrome.storage.local.set({
        popupWindowId,
      });
    },
  );
};

const verifyAccess = async (requestingDomain) => {
  return new Promise((resolve) => {
    chrome.storage.local.get(['whitelist'], (result) => {
      const { whitelist } = result;
      if (!whitelist) {
        resolve(false);
        return;
      }

      if (whitelist.map((i) => i.domain).includes(requestingDomain)) {
        resolve(true);
      } else {
        resolve(false);
      }
      resolve(false);
    });
  });
};

const authorizeRequest = async (message) => {
  const { params } = message;
  return await verifyAccess(params.domain);
};

// MESSAGE LISTENER
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (['signedOut', 'networkChanged'].includes(message.action)) {
    return emitEventToActiveTabs(message);
  }

  const noAuthRequired = [
    'isConnected',
    'userConnectResponse',
    'sendRxdResponse',
    'transferTokenResponse',
    'signMessageResponse',
    'signTransactionResponse',
    'broadcastResponse',
    'getSignaturesResponse',
    'encryptResponse',
    'decryptResponse',
  ];

  if (noAuthRequired.includes(message.action)) {
    switch (message.action) {
      case 'isConnected':
        return processIsConnectedRequest(message, sendResponse);
      case 'userConnectResponse':
        return processConnectResponse(message);
      case 'sendRxdResponse':
        return processSendRxdResponse(message);
      case 'transferTokenResponse':
        return processTransferTokenResponse(message);
      case 'signMessageResponse':
        return processSignMessageResponse(message);
      case 'broadcastResponse':
        return processBroadcastResponse(message);
      case 'getSignaturesResponse':
        return processGetSignaturesResponse(message);
      case 'encryptResponse':
        return processEncryptResponse(message);
      case 'decryptResponse':
        return processDecryptResponse(message);
      default:
        break;
    }

    return;
  }

  // We need to authorize access for these endpoints
  authorizeRequest(message).then((isAuthorized) => {
    if (message.action === 'connect') {
      return processConnectRequest(message, sendResponse, isAuthorized);
    }

    if (!isAuthorized) {
      sendResponse({
        type: message.action,
        success: false,
        error: 'Unauthorized!',
      });
      return;
    }

    switch (message.action) {
      case 'disconnect':
        return processDisconnectRequest(message, sendResponse);
      case 'getPubKeys':
        return processGetPubKeysRequest(sendResponse);
      case 'getBalance':
        return processGetBalanceRequest(sendResponse);
      case 'getAddresses':
        return processGetAddressesRequest(sendResponse);
      case 'getNetwork':
        return processGetNetworkRequest(sendResponse);
      case 'getTokens':
        return processGetTokenRequest(sendResponse);
      case 'sendRxd':
        return processSendRxdRequest(message, sendResponse);
      //case 'transferToken':
      //  return processTransferTokenRequest(message, sendResponse);
      case 'signMessage':
        return processSignMessageRequest(message, sendResponse);
      case 'broadcast':
        return processBroadcastRequest(message, sendResponse);
      case 'getSignatures':
        return processGetSignaturesRequest(message, sendResponse);
      case 'getSocialProfile':
        return processGetSocialProfileRequest(sendResponse);
      case 'getPaymentUtxos':
        return processGetPaymentUtxos(sendResponse);
      case 'getExchangeRate':
        return processGetExchangeRate(sendResponse);
      case 'encrypt':
        return processEncryptRequest(message, sendResponse);
      case 'decrypt':
        return processDecryptRequest(message, sendResponse);
      default:
        break;
    }
  });

  return true;
});

// EMIT EVENTS ********************************

const emitEventToActiveTabs = (message) => {
  const { action, params } = message;
  chrome.tabs.query({ active: true }, function (tabs) {
    tabs.forEach(function (tab) {
      chrome.tabs.sendMessage(tab.id || 0, { type: 'OrbitalEmitEvent', action, params });
    });
  });
  return true;
};

// REQUESTS ***************************************

const processConnectRequest = (message, sendResponse, isAuthorized) => {
  responseCallbackForConnectRequest = sendResponse;
  chrome.storage.local
    .set({
      connectRequest: { ...message.params, isAuthorized },
    })
    .then(() => {
      launchPopUp();
    });

  return true;
};

const processDisconnectRequest = (message, sendResponse) => {
  try {
    chrome.storage.local.get(['whitelist'], (result) => {
      if (!result.whitelist) throw Error('Already disconnected!');
      const { params } = message;

      const updatedWhitelist = result.whitelist.filter((i) => i.domain !== params.domain);

      chrome.storage.local.set({ whitelist: updatedWhitelist }, () => {
        sendResponse({
          type: 'disconnect',
          success: true,
          data: true,
        });
      });
    });
  } catch (error) {
    sendResponse({
      type: 'disconnect',
      success: true, // This is true in the catch because we want to return a boolean
      data: false,
    });
  }
};

const processIsConnectedRequest = (message, sendResponse) => {
  try {
    chrome.storage.local.get(['appState', 'lastActiveTime', 'whitelist'], (result) => {
      const currentTime = Date.now();
      const lastActiveTime = result.lastActiveTime;

      sendResponse({
        type: 'isConnected',
        success: true,
        data:
          !result?.appState?.isLocked &&
          currentTime - lastActiveTime < INACTIVITY_LIMIT &&
          result.whitelist?.map((i) => i.domain).includes(message.params.domain),
      });
    });
  } catch (error) {
    sendResponse({
      type: 'isConnected',
      success: true, // This is true in the catch because we want to return a boolean
      error: false,
    });
  }

  return true;
};

const processGetBalanceRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['appState'], (result) => {
      sendResponse({
        type: 'getBalance',
        success: true,
        data: result?.appState?.balance,
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getBalance',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetPubKeysRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['appState'], (result) => {
      sendResponse({
        type: 'getPubKeys',
        success: true,
        data: result?.appState?.pubKeys,
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getPubKeys',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetAddressesRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['appState'], (result) => {
      sendResponse({
        type: 'getAddresses',
        success: true,
        data: result?.appState?.addresses,
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getAddresses',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetNetworkRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['appState'], (result) => {
      sendResponse({
        type: 'getNetwork',
        success: true,
        data: result?.appState?.network ?? 'mainnet',
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getNetwork',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetTokenRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['appState'], (result) => {
      sendResponse({
        type: 'getTokens',
        success: true,
        data: result?.appState?.tokens ?? [],
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getTokens',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetExchangeRate = (sendResponse) => {
  try {
    getExchangeRate().then((rate: any) => {
      sendResponse({
        type: 'getExchangeRate',
        success: true,
        data: Number(rate.toFixed(2)),
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getExchangeRate',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetPaymentUtxos = async (sendResponse) => {
  try {
    const paymentUtxos = await db.utxo.where({ type: 'rxd' }).toArray();
    console.log(paymentUtxos);
    sendResponse({
      type: 'getPaymentUtxos',
      success: true,
      data:
        paymentUtxos.length > 0
          ? paymentUtxos.map((utxo) => {
              return {
                value: Number(utxo.value), // bigints don't seem to work
                txid: utxo.txid,
                vout: utxo.vout,
              };
            })
          : [],
    });
  } catch (error) {
    sendResponse({
      type: 'getPaymentUtxos',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processSendRxdRequest = (message, sendResponse) => {
  if (!message.params.data) {
    sendResponse({
      type: 'sendRxd',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForSendRxdRequest = sendResponse;
    let sendRxdRequest = message.params.data;

    chrome.storage.local.set({ sendRxdRequest }).then(() => {
      launchPopUp();
    });
  } catch (error) {
    sendResponse({
      type: 'sendRxd',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

/*
const processTransferTokenRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'transferToken',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForTransferTokenRequest = sendResponse;
    chrome.storage.local
      .set({
        transferTokenRequest: message.params,
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'transferToken',
      success: false,
      error: JSON.stringify(error),
    });
  }
};
*/

const processBroadcastRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'broadcast',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForBroadcastRequest = sendResponse;
    chrome.storage.local
      .set({
        broadcastRequest: message.params,
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'broadcast',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processSignMessageRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'signMessage',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForSignMessageRequest = sendResponse;
    chrome.storage.local
      .set({
        signMessageRequest: message.params,
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'signMessage',
      success: false,
      error: JSON.stringify(error),
    });
  }

  return true;
};

const processGetSignaturesRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'getSignatures',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForGetSignaturesRequest = sendResponse;
    chrome.storage.local
      .set({
        getSignaturesRequest: {
          rawtx: message.params.rawtx,
          sigRequests: message.params.sigRequests,
        },
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'getSignatures',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processGetSocialProfileRequest = (sendResponse) => {
  try {
    chrome.storage.local.get(['socialProfile'], (result) => {
      const displayName = result?.socialProfile?.displayName ? result.socialProfile.displayName : 'Anon Orbital';
      const avatar = result?.socialProfile?.avatar ? result.socialProfile.avatar : undefined;
      sendResponse({
        type: 'getSocialProfile',
        success: true,
        data: { displayName, avatar },
      });
    });
  } catch (error) {
    sendResponse({
      type: 'getSocialProfile',
      success: false,
      error: JSON.stringify(error),
    });
  }
};

const processEncryptRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'encrypt',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForEncryptRequest = sendResponse;
    chrome.storage.local
      .set({
        encryptRequest: message.params,
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'encrypt',
      success: false,
      error: JSON.stringify(error),
    });
  }

  return true;
};

const processDecryptRequest = (message, sendResponse) => {
  if (!message.params) {
    sendResponse({
      type: 'decrypt',
      success: false,
      error: 'Must provide valid params!',
    });
  }
  try {
    responseCallbackForDecryptRequest = sendResponse;
    chrome.storage.local
      .set({
        decryptRequest: message.params,
      })
      .then(() => {
        launchPopUp();
      });
  } catch (error) {
    sendResponse({
      type: 'decrypt',
      success: false,
      error: JSON.stringify(error),
    });
  }

  return true;
};

// RESPONSES ********************************

const processConnectResponse = (response) => {
  try {
    if (responseCallbackForConnectRequest) {
      responseCallbackForConnectRequest({
        type: 'connect',
        success: true,
        data: response.decision === 'approved' ? response.pubKeys.identityPubKey : undefined,
      });
    }
  } catch (error) {
    responseCallbackForConnectRequest({
      type: 'connect',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForConnectRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove('popupWindowId');
  }

  return true;
};

const processSendRxdResponse = (response) => {
  if (!responseCallbackForSendRxdRequest) throw Error('Missing callback!');
  try {
    responseCallbackForSendRxdRequest({
      type: 'sendRxd',
      success: true,
      data: { txid: response.txid, rawtx: response.rawtx },
    });
  } catch (error) {
    responseCallbackForSendRxdRequest({
      type: 'sendRxd',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForSendRxdRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['sendRxdRequest', 'popupWindowId']);
  }

  return true;
};

const processTransferTokenResponse = (response) => {
  if (!responseCallbackForTransferTokenRequest) throw Error('Missing callback!');
  try {
    responseCallbackForTransferTokenRequest({
      type: 'transferToken',
      success: true,
      data: response?.txid,
    });
  } catch (error) {
    responseCallbackForTransferTokenRequest({
      type: 'transferToken',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForTransferTokenRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['transferTokenRequest', 'popupWindowId']);
  }

  return true;
};

const processSignMessageResponse = (response) => {
  if (!responseCallbackForSignMessageRequest) throw Error('Missing callback!');
  try {
    responseCallbackForSignMessageRequest({
      type: 'signMessage',
      success: true,
      data: {
        address: response?.address,
        pubKey: response?.pubKey,
        message: response?.message,
        sig: response?.sig,
        derivationTag: response?.derivationTag,
      },
    });
  } catch (error) {
    responseCallbackForSignMessageRequest({
      type: 'signMessage',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForSignMessageRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['signMessageRequest', 'popupWindowId']);
  }

  return true;
};

const processBroadcastResponse = (response) => {
  if (!responseCallbackForBroadcastRequest) throw Error('Missing callback!');
  try {
    if (response?.error) {
      responseCallbackForBroadcastRequest({
        type: 'broadcast',
        success: false,
        error: response?.error,
      });
      return;
    }
    responseCallbackForBroadcastRequest({
      type: 'broadcast',
      success: true,
      data: response?.txid,
    });
  } catch (error) {
    responseCallbackForBroadcastRequest({
      type: 'broadcast',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForBroadcastRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['broadcastRequest', 'popupWindowId']);
  }

  return true;
};

const processGetSignaturesResponse = (response) => {
  if (!responseCallbackForGetSignaturesRequest) throw Error('Missing callback!');
  try {
    responseCallbackForGetSignaturesRequest({
      type: 'getSignatures',
      success: !response?.error,
      data: response?.sigResponses ?? [],
      error: response?.error,
    });
  } catch (error) {
    responseCallbackForGetSignaturesRequest({
      type: 'getSignatures',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForGetSignaturesRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['getSignaturesRequest', 'popupWindowId']);
  }

  return true;
};

const processEncryptResponse = (response) => {
  if (!responseCallbackForEncryptRequest) throw Error('Missing callback!');
  try {
    responseCallbackForEncryptRequest({
      type: 'encrypt',
      success: true,
      data: response.encryptedMessages,
    });
  } catch (error) {
    responseCallbackForEncryptRequest({
      type: 'encrypt',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForEncryptRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['encryptRequest', 'popupWindowId']);
  }

  return true;
};

const processDecryptResponse = (response) => {
  if (!responseCallbackForDecryptRequest) throw Error('Missing callback!');
  try {
    responseCallbackForDecryptRequest({
      type: 'decrypt',
      success: true,
      data: response.decryptedMessages,
    });
  } catch (error) {
    responseCallbackForDecryptRequest({
      type: 'decrypt',
      success: false,
      error: JSON.stringify(error),
    });
  } finally {
    responseCallbackForDecryptRequest = null;
    popupWindowId = null;
    chrome.storage.local.remove(['decryptRequest', 'popupWindowId']);
  }

  return true;
};

// HANDLE WINDOW CLOSE *****************************************

chrome.windows.onRemoved.addListener((closedWindowId) => {
  if (closedWindowId === popupWindowId) {
    if (responseCallbackForConnectRequest) {
      responseCallbackForConnectRequest({
        type: 'connect',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForConnectRequest = null;
      chrome.storage.local.remove('connectRequest');
    }

    if (responseCallbackForSendRxdRequest) {
      responseCallbackForSendRxdRequest({
        type: 'sendRxd',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForSendRxdRequest = null;
      chrome.storage.local.remove('sendRxdRequest');
    }

    if (responseCallbackForSignMessageRequest) {
      responseCallbackForSignMessageRequest({
        type: 'signMessage',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForSignMessageRequest = null;
      chrome.storage.local.remove('signMessageRequest');
    }

    if (responseCallbackForTransferTokenRequest) {
      responseCallbackForTransferTokenRequest({
        type: 'transferToken',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForTransferTokenRequest = null;
      chrome.storage.local.remove('transferTokenRequest');
    }

    if (responseCallbackForBroadcastRequest) {
      responseCallbackForBroadcastRequest({
        type: 'broadcast',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForBroadcastRequest = null;
      chrome.storage.local.remove('broadcastRequest');
    }

    if (responseCallbackForGetSignaturesRequest) {
      responseCallbackForGetSignaturesRequest({
        type: 'getSignatures',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForGetSignaturesRequest = null;
      chrome.storage.local.remove('getSignaturesRequest');
    }

    if (responseCallbackForEncryptRequest) {
      responseCallbackForEncryptRequest({
        type: 'encrypt',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForEncryptRequest = null;
      chrome.storage.local.remove('encryptRequest');
    }

    if (responseCallbackForDecryptRequest) {
      responseCallbackForDecryptRequest({
        type: 'decrypt',
        success: false,
        error: 'User dismissed the request!',
      });
      responseCallbackForDecryptRequest = null;
      chrome.storage.local.remove('decryptRequest');
    }

    popupWindowId = null;
    chrome.storage.local.remove('popupWindowId');
  }
});
