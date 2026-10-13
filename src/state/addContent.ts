// Acceso global a los flujos de añadir contenido.

import { createContext, useContext } from 'react';

export interface AddContentValue {
  openAdd: () => void;
  openPaste: () => void;
  pickFile: () => void;
}

export const AddContentContext = createContext<AddContentValue>({
  openAdd: () => {},
  openPaste: () => {},
  pickFile: () => {},
});

export function useAddContent(): AddContentValue {
  return useContext(AddContentContext);
}
