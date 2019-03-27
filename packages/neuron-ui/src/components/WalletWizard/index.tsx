import React, { useContext } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import Screen from '../../widgets/Screen'
import ScreenButtonRow from '../../widgets/ScreenButtonRow'

import WalletContext from '../../contexts/Wallet'
import { Routes, MnemonicAction } from '../../utils/const'

const buttons = [
  { label: 'wizard.create-new-wallet', href: `${Routes.Mnemonic}/${MnemonicAction.Create}` },
  { label: 'wizard.import-wallet', href: `${Routes.Mnemonic}/${MnemonicAction.Import}` },
]

const Wizard = () => {
  const { address } = useContext(WalletContext)
  const [t] = useTranslation()
  const message = 'wizard.create-or-import-your-first-wallet'
  return (
    <Screen full={!address}>
      <div>
        <h1>{t(message)}</h1>
        <ScreenButtonRow>
          {buttons.map(({ label, href }) => (
            <Link key={label} className="btn btn-primary" to={href}>
              {t(label)}
            </Link>
          ))}
        </ScreenButtonRow>
      </div>
    </Screen>
  )
}

Wizard.displayName = 'Wizard'

export default Wizard
