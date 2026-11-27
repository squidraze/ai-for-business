import { createContext, useContext } from 'react';

/**
 * Lets a field inside a connector card ask the Connectors page to scroll it into
 * view once the keyboard is up (the webhook field is the last thing on the page).
 */
export const ConnectorsScrollContext = createContext<{ revealEnd: () => void }>({ revealEnd: () => {} });

export const useConnectorsScroll = () => useContext(ConnectorsScrollContext);
