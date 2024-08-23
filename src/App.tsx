import { useContext, useEffect, useState } from 'react';
import { MemoryRouter as Router, Route, Routes } from 'react-router-dom';
import styled from 'styled-components';
import { Show } from './components/Show';
import { UnlockWallet } from './components/UnlockWallet';
import { BottomMenuContext, BottomMenuProvider } from './contexts/BottomMenuContext';
import { SnackbarProvider } from './contexts/SnackbarContext';
import { useActivityDetector } from './hooks/useActivityDetector';
import {
  Web3BroadcastRequest,
  Web3DecryptRequest,
  Web3EncryptRequest,
  Web3SendRxdRequest,
  Web3SignMessageRequest,
} from './hooks/useRxd';
import { Web3GetSignaturesRequest } from './hooks/useContracts';
import { useTheme } from './hooks/useTheme';
import { useViewport } from './hooks/useViewport';
import { AppsAndTools } from './pages/AppsAndTools';
import { RxdWallet } from './pages/RxdWallet';
import { CreateWallet } from './pages/onboarding/CreateWallet';
import { RestoreWallet } from './pages/onboarding/RestoreWallet';
import { Start } from './pages/onboarding/Start';
import { TokenWallet } from './pages/TokenWallet';
import { BroadcastRequest } from './pages/requests/BroadcastRequest';
import { RxdSendRequest } from './pages/requests/RxdSendRequest';
import { ConnectRequest } from './pages/requests/ConnectRequest';
import { DecryptRequest } from './pages/requests/DecryptRequest';
import { EncryptRequest } from './pages/requests/EncryptRequest';
import { GetSignaturesRequest } from './pages/requests/GetSignaturesRequest';
import { SignMessageRequest } from './pages/requests/SignMessageRequest';
import { Settings } from './pages/Settings';
import { ColorThemeProps } from './theme';
import { storage } from './utils/storage';
import electrum from './Electrum';
import { locked, rxdAddress, walletExists } from './signals';
import { useSignals } from '@preact/signals-react/runtime';

export type ThirdPartyAppRequestData = {
  appName: string;
  appIcon: string;
  domain: string;
  isAuthorized: boolean;
};

export type WhitelistedApp = {
  domain: string;
  icon: string;
};

const MainContainer = styled.div<{ $isMobile?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${(props) => (props.$isMobile ? '100vw' : '22.5rem')};
  height: ${(props) => (props.$isMobile ? '100vh' : '33.75rem')};
  position: relative;
  padding: 0;
`;

const Container = styled.div<ColorThemeProps>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background-color: ${({ theme }) => theme.mainBackground};
  position: relative;
`;
export const App = () => {
  useSignals();
  const { isMobile } = useViewport();
  const { theme } = useTheme();
  const menuContext = useContext(BottomMenuContext);
  const [popupId, setPopupId] = useState<number | undefined>();
  const [whitelistedApps, setWhitelistedApps] = useState<WhitelistedApp[]>([]);

  const [messageToSign, setMessageToSign] = useState<Web3SignMessageRequest | undefined>();
  const [broadcastRequest, setBroadcastRequest] = useState<Web3BroadcastRequest | undefined>();
  const [thirdPartyAppRequestData, setThirdPartyAppRequestData] = useState<ThirdPartyAppRequestData | undefined>();
  const [rxdSendRequest, setRxdSendRequest] = useState<Web3SendRxdRequest | undefined>();
  const [getSignaturesRequest, setGetSignaturesRequest] = useState<Web3GetSignaturesRequest | undefined>();
  const [messageToEncrypt, setMessageToEncrypt] = useState<Web3EncryptRequest | undefined>();
  const [messagesToDecrypt, setMessagesToDecrypt] = useState<Web3DecryptRequest | undefined>();

  useActivityDetector();

  const handleUnlock = async () => {
    window.location.reload();
  };

  useEffect(() => {
    storage.get(
      [
        'sendRxdRequest',
        'connectRequest',
        'popupWindowId',
        'whitelist',
        'signMessageRequest',
        'signTransactionRequest',
        'broadcastRequest',
        'getSignaturesRequest',
        'encryptRequest',
        'decryptRequest',
      ],
      (result) => {
        const {
          popupWindowId,
          connectRequest,
          whitelist,
          sendRxdRequest,
          signMessageRequest,
          broadcastRequest,
          getSignaturesRequest,
          encryptRequest,
          decryptRequest,
        } = result;

        if (popupWindowId) setPopupId(popupWindowId);
        if (locked.value) return;

        if (connectRequest && !locked.value) {
          setThirdPartyAppRequestData(connectRequest);
        }

        if (whitelist) {
          setWhitelistedApps(whitelist);
        }

        if (sendRxdRequest) {
          setRxdSendRequest(sendRxdRequest);
        }

        if (signMessageRequest) {
          setMessageToSign(signMessageRequest);
        }

        if (broadcastRequest) {
          setBroadcastRequest(broadcastRequest);
        }

        if (getSignaturesRequest) {
          setGetSignaturesRequest(getSignaturesRequest);
        }

        if (encryptRequest) {
          setMessageToEncrypt(encryptRequest);
        }

        if (decryptRequest) {
          setMessagesToDecrypt(decryptRequest);
        }
      },
    );
  }, [menuContext]);

  useEffect(() => {
    electrum.changeEndpoint('wss://electrumx.radiant4people.com:50022');
  }, []);

  return (
    <Router>
      <MainContainer $isMobile={isMobile}>
        <BottomMenuProvider>
          <Container theme={theme}>
            <SnackbarProvider>
              <Show
                when={!locked.value || !walletExists.value}
                whenFalseContent={<UnlockWallet onUnlock={handleUnlock} />}
              >
                <Routes>
                  <Route path="/" element={<Start />} />
                  <Route path="/create-wallet" element={<CreateWallet />} />
                  <Route path="/restore-wallet" element={<RestoreWallet />} />
                  <Route
                    path="/connect"
                    element={
                      <ConnectRequest
                        thirdPartyAppRequestData={thirdPartyAppRequestData}
                        popupId={popupId}
                        whiteListedApps={whitelistedApps}
                        onDecision={() => setThirdPartyAppRequestData(undefined)}
                      />
                    }
                  />
                  <Route
                    path="/rxd-wallet"
                    element={
                      <Show
                        when={
                          !rxdSendRequest &&
                          !messageToSign &&
                          !broadcastRequest &&
                          !getSignaturesRequest &&
                          !messageToEncrypt &&
                          !messagesToDecrypt
                        }
                        whenFalseContent={
                          <>
                            <Show when={!!rxdSendRequest}>
                              <RxdSendRequest
                                popupId={popupId}
                                web3Request={rxdSendRequest as Web3SendRxdRequest}
                                onResponse={() => setRxdSendRequest(undefined)}
                              />
                            </Show>
                            <Show when={!!messageToSign}>
                              <SignMessageRequest
                                messageToSign={messageToSign as Web3SignMessageRequest}
                                popupId={popupId}
                                onSignature={() => setMessageToSign(undefined)}
                              />
                            </Show>
                            <Show when={!!broadcastRequest}>
                              <BroadcastRequest
                                request={broadcastRequest as Web3BroadcastRequest}
                                popupId={popupId}
                                onBroadcast={() => setBroadcastRequest(undefined)}
                              />
                            </Show>
                            <Show when={!!getSignaturesRequest}>
                              <GetSignaturesRequest
                                getSigsRequest={getSignaturesRequest as Web3GetSignaturesRequest}
                                popupId={popupId}
                                onSignature={() => setGetSignaturesRequest(undefined)}
                              />
                            </Show>
                            <Show when={!!messageToEncrypt}>
                              <EncryptRequest
                                messageToEncrypt={messageToEncrypt as Web3EncryptRequest}
                                popupId={popupId}
                                onEncrypt={() => setMessageToEncrypt(undefined)}
                              />
                            </Show>
                            <Show when={!!messagesToDecrypt}>
                              <DecryptRequest
                                encryptedMessages={messagesToDecrypt as Web3DecryptRequest}
                                popupId={popupId}
                                onDecrypt={() => setMessagesToDecrypt(undefined)}
                              />
                            </Show>
                          </>
                        }
                      >
                        <RxdWallet />
                      </Show>
                    }
                  />
                  <Route path="/token-wallet" element={<TokenWallet />} />
                  <Route path="/apps" element={<AppsAndTools />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Show>
            </SnackbarProvider>
          </Container>
        </BottomMenuProvider>
      </MainContainer>
    </Router>
  );
};
