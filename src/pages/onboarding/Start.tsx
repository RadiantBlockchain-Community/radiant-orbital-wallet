import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import gihubIcon from '../../assets/github.svg';
import { Button } from '../../components/Button';
import { GithubIcon, Text, OrbitalLogo } from '../../components/Reusable';
import { Show } from '../../components/Show';
import { useBottomMenu } from '../../hooks/useBottomMenu';
import { useTheme } from '../../hooks/useTheme';
import { ColorThemeProps } from '../../theme';
import { storage } from '../../utils/storage';

const Content = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
`;

const TitleText = styled.h1<ColorThemeProps>`
  font-size: 2rem;
  color: ${({ theme }) => theme.white};
  font-family: 'Inter', Arial, Helvetica, sans-serif;
  font-weight: 700;
  margin: 0.25rem 0;
  text-align: center;
`;

export const Start = () => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [showStart, setShowStart] = useState(false);
  const { hideMenu, showMenu } = useBottomMenu();

  useEffect(() => {
    hideMenu();

    return () => {
      showMenu();
    };
  }, [hideMenu, showMenu]);

  // If the encrypted keys are present, take the user to the wallet page.
  useEffect(() => {
    storage.get(['encryptedKeys', 'connectRequest'], (result) => {
      if (result?.connectRequest) {
        setShowStart(false);
        navigate('/connect');
        return;
      }

      if (result?.encryptedKeys) {
        setShowStart(false);
        navigate('/rxd-wallet');
        return;
      }
      setShowStart(true);
    });
  }, [navigate]);

  return (
    <Show when={showStart}>
      <Content>
        <OrbitalLogo />
        <TitleText theme={theme}>Orbital Wallet</TitleText>
        <Text theme={theme} style={{ margin: '0.25rem 0 1rem 0' }}>
          An open source project.
        </Text>
        <Button theme={theme} type="primary" label="Create New Wallet" onClick={() => navigate('/create-wallet')} />
        <Button
          theme={theme}
          type="secondary-outline"
          label="Restore Wallet"
          onClick={() => navigate('/restore-wallet')}
        />
      </Content>
    </Show>
  );
};
