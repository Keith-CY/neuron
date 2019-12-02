import { getConnection, In } from 'typeorm'
import OutputEntity from 'database/chain/entities/output'
import { Cell, OutPoint, Input } from 'types/cell-types'
import { CapacityNotEnough, CapacityNotEnoughForChange } from 'exceptions'
import { OutputStatus } from './tx/params'
import FeeMode from 'models/fee-mode'
import { TransactionStatus } from 'types/cell-types'
import TransactionEntity from 'database/chain/entities/transaction'
import { WitnessArgs } from '../types/cell-types';
import TransactionSize from '../models/transaction-size';
import TransactionFee from 'models/transaction-fee'

export const MIN_CELL_CAPACITY = '6100000000'

export default class CellsService {
  // exclude hasData = true and typeScript != null
  public static getBalance = async (
    lockHashes: string[],
    status: OutputStatus
  ): Promise<string> => {
    const cells: OutputEntity[] = await getConnection()
      .getRepository(OutputEntity)
      .createQueryBuilder('output')
      .select([
        "output.lockHash",
        "output.status",
        "output.hasData",
        "output.typeScript",
        "output.capacity"
      ])
      .where({
        lockHash: In(lockHashes),
        status,
        hasData: false,
        typeScript: null,
      })
      .getMany()

    const capacity: bigint = cells.map(c => BigInt(c.capacity)).reduce((result, c) => result + c, BigInt(0))

    return capacity.toString()
  }

  public static getDaoCells = async (
    lockHashes: string[],
  ): Promise<Cell[]> => {
    const outputs: OutputEntity[] = await getConnection()
      .getRepository(OutputEntity)
      .createQueryBuilder('output')
      .leftJoinAndSelect('output.transaction', 'tx')
      .where(`(output.status = :liveStatus OR tx.status = :failedStatus) AND output.daoData IS NOT NULL AND output.lockHash in (:...lockHashes) AND tx.blockNumber IS NOT NULL`, {
        lockHashes,
        liveStatus: OutputStatus.Live,
        failedStatus: TransactionStatus.Failed,
      })
      .orderBy(`CASE output.daoData WHEN '0x0000000000000000' THEN 1 ELSE 0 END`, 'ASC')
      .addOrderBy('tx.timestamp', 'ASC')
      .getMany()

    const cells = outputs.map(o => o.toInterface())

    const txHashes = outputs.map(output => output.depositTxHash).filter(hash => !!hash)

    const txs = await getConnection()
      .getRepository(TransactionEntity)
      .createQueryBuilder('tx')
      .where({
        hash: In(txHashes)
      })
      .getMany()

    for (const output of cells) {
      if (output.depositOutPoint) {
        const tx = txs.filter(t => t.hash === output.depositOutPoint!.txHash)[0]
        if (tx) {
          output.depositTimestamp = tx.timestamp
        }
      }
    }

    return cells
  }

  public static getLiveCell = async (outPoint: OutPoint): Promise<Cell | undefined> => {
    const cellEntity: OutputEntity | undefined = await CellsService.getLiveCellEntity(outPoint)

    if (!cellEntity) {
      return undefined
    }

    return cellEntity.toInterface()
  }

  private static getLiveCellEntity = async (outPoint: OutPoint): Promise<OutputEntity | undefined> => {
    const cellEntity: OutputEntity | undefined = await getConnection()
      .getRepository(OutputEntity)
      .findOne({
        outPointTxHash: outPoint.txHash,
        outPointIndex: outPoint.index,
        status: 'live',
      })

    return cellEntity
  }

  // gather inputs for generateTx
  public static gatherInputs = async (
    capacity: string,
    lockHashes: string[],
    fee: string = '0',
    feeRate: string = '0',
    baseSize: number = 0,
    changeOutputSize: number = 0,
    append?: {
      input: Input,
      witness: WitnessArgs,
    }
  ): Promise<{
    inputs: Input[]
    capacities: string
    finalFee: string
  }> => {
    const capacityInt = BigInt(capacity)
    const feeInt = BigInt(fee)
    const feeRateInt = BigInt(feeRate)
    let needFee = BigInt(0)
    const changeOutputFee: bigint = TransactionFee.fee(changeOutputSize, feeRateInt)

    const mode = new FeeMode(feeRateInt)

    // use min secp size (without data)
    const minChangeCapacity = BigInt(MIN_CELL_CAPACITY)

    // if (capacityInt < BigInt(MIN_CELL_CAPACITY)) {
    //   throw new Error(`capacity can't be less than ${MIN_CELL_CAPACITY}`)
    // }

    // only live cells, skip which has data or type
    const cellEntities: OutputEntity[] = await getConnection()
      .getRepository(OutputEntity)
      .find({
        where: {
          lockHash: In(lockHashes),
          status: OutputStatus.Live,
          hasData: false,
          typeScript: null,
        },
      })
    cellEntities.sort((a, b) => {
      const result = BigInt(a.capacity) - BigInt(b.capacity)
      if (result > BigInt(0)) {
        return 1
      }
      if (result === BigInt(0)) {
        return 0
      }
      return -1
    })

    const inputs: Input[] = []
    let inputCapacities: bigint = BigInt(0)
    let totalSize: number = baseSize
    if (append) {
      inputs.push(append.input)
      totalSize += TransactionSize.witness(append.witness)
    }
    cellEntities.every(cell => {
      const input: Input = {
        previousOutput: cell.outPoint(),
        since: '0',
        lock: cell.lock,
        lockHash: cell.lockHash,
        capacity: cell.capacity,
      }
      if (inputs.find(el => el.lockHash === cell.lockHash!)) {
        totalSize += TransactionSize.witness('0x')
      } else {
        const wit = {
          lock: '0x' + '0'.repeat(130),
          inputType: undefined,
          outputType: undefined,
        }
        totalSize += TransactionSize.witness(wit)
      }
      inputs.push(input)
      inputCapacities += BigInt(cell.capacity)
      totalSize += TransactionSize.input()

      if (mode.isFeeRateMode()) {
        needFee = TransactionFee.fee(totalSize, feeRateInt)
        const diff = inputCapacities - capacityInt - needFee
        if (diff === BigInt(0)) {
          return false
        } else if (diff - changeOutputFee >= minChangeCapacity) {
          needFee += changeOutputFee
          return false
        }
        return true
      } else {
        const diff = inputCapacities - capacityInt - feeInt
        if (diff >= minChangeCapacity || diff === BigInt(0)) {
          return false
        }
        return true
      }
    })

    // The final fee need in this tx (shannon)
    const finalFee: bigint = mode.isFeeRateMode() ? needFee : feeInt

    const totalCapacities = capacityInt + finalFee

    if (inputCapacities < totalCapacities) {
      throw new CapacityNotEnough()
    }

    const diffCapacities = inputCapacities - totalCapacities
    if (diffCapacities < minChangeCapacity && diffCapacities !== BigInt(0)) {
      throw new CapacityNotEnoughForChange()
    }

    return {
      inputs,
      capacities: inputCapacities.toString(),
      finalFee: finalFee.toString(),
    }
  }

  public static gatherAllInputs = async (lockHashes: string[]): Promise<Input[]> => {
    const cellEntities: OutputEntity[] = await getConnection()
      .getRepository(OutputEntity)
      .find({
        where: {
          lockHash: In(lockHashes),
          status: OutputStatus.Live,
          hasData: false,
          typeScript: null,
        },
      })

    const inputs: Input[] = cellEntities.map(cell => {
      return {
        previousOutput: cell.outPoint(),
        since: '0',
        lock: cell.lock,
        lockHash: cell.lockHash,
        capacity: cell.capacity,
      }
    })

    return inputs
  }

  public static allBlake160s = async (): Promise<string[]> => {
    const outputEntities = await getConnection()
      .getRepository(OutputEntity)
      .createQueryBuilder('output')
      .getMany()
    const blake160s: string[] = outputEntities
      .map(output => {
        const { lock } = output
        if (!lock) {
          return undefined
        }
        const { args } = lock
        if (!args) {
          return undefined
        }
        return args
      })
      .filter(blake160 => !!blake160) as string[]

    const uniqueBlake160s = [...new Set(blake160s)]

    return uniqueBlake160s
  }
}
