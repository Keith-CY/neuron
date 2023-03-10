import React, { useReducer } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useState as useGlobalState } from 'states'

export interface Element {
  path: string
  comp: React.FC<any>
}

export interface WithWizardState {
  [key: string]: string
}

export interface WizardProps {
  state: WithWizardState
  elements: Element[]
  wallets: Readonly<State.WalletIdentity[]>
  rootPath: string
  dispatch: React.Dispatch<any>
  isSettings?: boolean
}

export interface WizardElementProps {
  wallets: State.Wallet[]
  rootPath: string
  state: WithWizardState
  dispatch: React.Dispatch<any>
  isSettings?: boolean
}

const reducer = (
  state: { [key: string]: string },
  {
    type,
    payload,
  }: {
    type: string
    payload: string
  }
) => {
  switch (type) {
    default: {
      return { ...state, [type]: payload }
    }
  }
}

const Wizard = ({ state, elements, wallets, rootPath, dispatch, isSettings }: WizardProps) => (
  <Routes>
    {elements.map((element: any) => (
      <Route
        key={element.path}
        path={`${element.path || ''}${element.params || ''}`}
        element={
          <element.comp
            rootPath={rootPath}
            wallets={wallets}
            state={state}
            dispatch={dispatch}
            isSettings={isSettings}
          />
        }
      />
    ))}
  </Routes>
)

Wizard.displayName = 'Wizard'

const withWizard = (elements: Element[], initState: WithWizardState) => ({ isSettings }: { isSettings?: boolean }) => {
  const {
    settings: { wallets = [] },
  } = useGlobalState()
  const [state, dispatch] = useReducer(reducer, initState)

  return (
    <Wizard
      rootPath="/wizard/"
      isSettings={isSettings}
      state={state}
      wallets={wallets}
      dispatch={dispatch}
      elements={elements}
    />
  )
}

export default withWizard
