import { validate } from 'bitcoin-address-validation';
import React, { useEffect, useState } from 'react';
import { styled } from 'styled-components';
import rxdCoin from '../../assets/rxd-coin.png';
import { BackButton } from '../../components/BackButton';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { PageLoader } from '../../components/PageLoader';
import { ConfirmContent, FormContainer, HeaderText, Text } from '../../components/Reusable';
import { Show } from '../../components/Show';
import { useBottomMenu } from '../../hooks/useBottomMenu';
import { useRxd, Web3SendRxdRequest } from '../../hooks/useRxd';
import { useSnackbar } from '../../hooks/useSnackbar';
import { useTheme } from '../../hooks/useTheme';
import { useWeb3Context } from '../../hooks/useWeb3Context';
import { ColorThemeProps } from '../../theme';
import { RXD_DECIMAL_CONVERSION } from '../../utils/constants';
import { truncate } from '../../utils/format';
import { sleep } from '../../utils/sleep';
import { storage } from '../../utils/storage';
import { rxdAddress } from '../../signals';

const RequestDetailsContainer = styled.div<ColorThemeProps>`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-height: 10rem;
  overflow-y: auto;
  overflow-x: hidden;
  background: ${({ theme }) => theme.darkAccent + '80'};
  margin: 0.5rem;
`;

const LineItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0.25rem;
  width: 60%;
  z-index: 100;
`;

const Icon = styled.img`
  width: 1rem;
  height: 1rem;
`;

export type RxdSendRequestProps = {
  web3Request: Web3SendRxdRequest;
  requestWithinApp?: boolean;
  popupId: number | undefined;
  onResponse: () => void;
};

export const RxdSendRequest = (props: RxdSendRequestProps) => {
  const { web3Request, requestWithinApp, popupId, onResponse } = props;
  const { theme } = useTheme();
  const { setSelected } = useBottomMenu();
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [successTxId, setSuccessTxId] = useState('');
  const { addSnackbar, message } = useSnackbar();
  const { isPasswordRequired, noApprovalLimit } = useWeb3Context();
  const { rxdBalance, isProcessing, setIsProcessing, sendRxd, updateRxdBalance } = useRxd();
  const [hasSent, setHasSent] = useState(false);

  const requestSats = web3Request.reduce((a: number, item: { satoshis: number }) => a + item.satoshis, 0);
  const rxdSendAmount = requestSats / RXD_DECIMAL_CONVERSION;

  // This useEffect handle the instance where the request is below the no approval setting and will immediately process the request.
  useEffect(() => {
    if (hasSent || noApprovalLimit === undefined) return;
    if (web3Request.length > 0 && rxdSendAmount <= noApprovalLimit) {
      setHasSent(true);

      // Using timeout here so that the state that sendRxd relies on is ready. Not ideal but can refactor later.
      // TODO: Should consider a broader refactor of how state is being handled across hooks and context when the time is right.
      setTimeout(() => {
        processRxdSend();
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxdSendAmount, noApprovalLimit, web3Request, hasSent]);

  useEffect(() => {
    if (requestWithinApp) return;
    setSelected('rxd');
  }, [requestWithinApp, setSelected]);

  useEffect(() => {
    if (!successTxId) return;
    if (!message && rxdAddress.value) {
      resetSendState();
      updateRxdBalance(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successTxId, message, updateRxdBalance]);

  useEffect(() => {
    if (requestWithinApp) return;

    const onbeforeunloadFn = () => {
      if (popupId) chrome.windows.remove(popupId);
    };

    window.addEventListener('beforeunload', onbeforeunloadFn);
    return () => {
      window.removeEventListener('beforeunload', onbeforeunloadFn);
    };
  }, [requestWithinApp, popupId]);

  const processRxdSend = async () => {
    try {
      let validationFail = new Map<string, boolean>();
      validationFail.set('address', false);
      validationFail.set('script', false);
      validationFail.set('data', false);

      web3Request.forEach((request) => {
        // validate script or data if they are set
        if (request.script?.length === 0) {
          validationFail.set('script', true);
          return;
        } else if (request.data) {
          if (request.data.length === 0) {
            validationFail.set('data', true);
            return;
          }
        }
        // otherwise sending to address
        if (request.address && !validate(request.address)) {
          validationFail.set('address', true);
          return;
        }
      });
      let validationErrorMessage = '';
      if (validationFail.get('script')) {
        validationErrorMessage = 'Found an invalid script.';
      } else if (validationFail.get('data')) {
        validationErrorMessage = 'Found an invalid data.';
      } else if (validationFail.get('address')) {
        validationErrorMessage = 'Found an invalid receive address.';
      }

      if (validationErrorMessage) {
        addSnackbar(validationErrorMessage, 'error');
        return;
      }

      if (web3Request[0].address && !web3Request[0].satoshis) {
        addSnackbar('No sats supplied', 'info');
        return;
      }

      const sendRes = await sendRxd(web3Request, passwordConfirm, noApprovalLimit);
      if (!sendRes.txid || sendRes.error) {
        const message =
          sendRes.error === 'invalid-password'
            ? 'Invalid Password!'
            : sendRes.error === 'insufficient-funds'
              ? 'Insufficient Funds!'
              : sendRes.error === 'fee-too-high'
                ? 'Miner fee too high!'
                : sendRes.error === 'tx-size-too-large'
                  ? 'Tx too big. 50MB max'
                  : 'An unknown error has occurred! Try again.' + sendRes.error;

        addSnackbar(message, 'error');
        return;
      }

      setSuccessTxId(sendRes.txid);
      addSnackbar('Transaction Successful!', 'success');

      // This should only get called if it's from the provider.
      if (!requestWithinApp) {
        chrome.runtime.sendMessage({
          action: 'sendRxdResponse',
          txid: sendRes.txid,
          rawtx: sendRes.rawtx,
        });
      }

      setTimeout(async () => {
        onResponse();
        if (!requestWithinApp) {
          storage.remove('sendRxdRequest');
        }

        if (popupId) chrome.windows.remove(popupId);
      }, 2000);
    } catch (error) {
      console.log(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetSendState = () => {
    setPasswordConfirm('');
    setSuccessTxId('');
    setIsProcessing(false);
  };

  const handleSendRxd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsProcessing(true);
    await sleep(25);

    if (noApprovalLimit === undefined) throw Error('No approval limit must be a number');
    if (!passwordConfirm && isPasswordRequired && rxdSendAmount > noApprovalLimit) {
      addSnackbar('You must enter a password!', 'error');
      setIsProcessing(false);
      return;
    }

    processRxdSend();
  };

  const web3Details = () => {
    return web3Request.map((r, i) => {
      return (
        <LineItem key={i}>
          <Icon src={rxdCoin} />
          <Text style={{ margin: 0 }} theme={theme}>{`${r.satoshis / RXD_DECIMAL_CONVERSION}`}</Text>
          <Text style={{ margin: 0 }} theme={theme}>
            {r.address ? truncate(r.address, 5, 5) : ''}
          </Text>
        </LineItem>
      );
    });
  };

  const clearRequest = () => {
    storage.remove('sendRxdRequest');
    if (popupId) chrome.windows.remove(popupId);
    window.location.reload();
  };

  return (
    <>
      <Show when={isProcessing}>
        <PageLoader theme={theme} message="Sending RXD..." />
      </Show>
      <Show when={!isProcessing && !!web3Request && !hasSent}>
        <ConfirmContent>
          <BackButton onClick={clearRequest} />
          <HeaderText theme={theme}>Approve Request</HeaderText>
          <Text
            theme={theme}
            style={{ cursor: 'pointer', margin: '0.75rem 0' }}
          >{`Available Balance: ${rxdBalance}`}</Text>
          <FormContainer noValidate onSubmit={(e) => handleSendRxd(e)}>
            <RequestDetailsContainer>{web3Details()}</RequestDetailsContainer>
            <Show when={isPasswordRequired}>
              <Input
                theme={theme}
                placeholder="Enter Wallet Password"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </Show>
            <Text theme={theme} style={{ margin: '1rem' }}>
              Double check details before sending.
            </Text>
            <Button
              theme={theme}
              type="primary"
              label={`Approve ${web3Request.reduce((a, item) => a + item.satoshis, 0) / RXD_DECIMAL_CONVERSION} RXD`}
              disabled={isProcessing}
              isSubmit
            />
          </FormContainer>
        </ConfirmContent>
      </Show>
    </>
  );
};
