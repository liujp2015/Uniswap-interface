// 导入必要的依赖库和类型
import { BigNumber } from '@ethersproject/bignumber' // 以太坊大数处理库
import type { Percent } from '@uniswap/sdk-core' // 百分比类型定义
import { TradeType } from '@uniswap/sdk-core' // 交易类型枚举（EXACT_INPUT/EXACT_OUTPUT）
import type { FlatFeeOptions } from '@uniswap/universal-router-sdk' // 固定费用选项类型
import type { FeeOptions } from '@uniswap/v3-sdk' // 百分比费用选项类型
import { TradingApi } from '@universe/api' // 交易API相关
import { useAccount } from 'hooks/useAccount' // 账户信息Hook
import type { PermitSignature } from 'hooks/usePermitAllowance' // 授权签名类型
import useSelectChain from 'hooks/useSelectChain' // 链选择Hook
import { useUniswapXSwapCallback } from 'hooks/useUniswapXSwapCallback' // Uniswap X交易回调Hook
import { useUniversalRouterSwapCallback } from 'hooks/useUniversalRouter' // Universal Router交易回调Hook
import { useCallback } from 'react' // React性能优化Hook
import { useDispatch } from 'react-redux' // Redux状态管理Hook
import { useMultichainContext } from 'state/multichain/useMultichainContext' // 多链上下文Hook
import type { InterfaceTrade } from 'state/routing/types' // 交易接口类型
import { TradeFillType } from 'state/routing/types' // 交易执行类型
import { isClassicTrade, isLimitTrade, isUniswapXTrade } from 'state/routing/utils' // 交易类型判断工具函数
import { useTransaction, useTransactionAdder } from 'state/transactions/hooks' // 交易相关Hook
import type { TransactionInfo } from 'state/transactions/types' // 交易信息类型
import { useSupportedChainId } from 'uniswap/src/features/chains/hooks/useSupportedChainId' // 支持链ID Hook
import { isEVMChain } from 'uniswap/src/features/platforms/utils/chains' // EVM链判断函数
import { addTransaction } from 'uniswap/src/features/transactions/slice' // 添加交易action
import {
  InterfaceTransactionDetails,
  QueuedOrderStatus,
  TransactionOriginType,
  TransactionStatus,
  TransactionType,
  UniswapXOrderDetails,
} from 'uniswap/src/features/transactions/types/transactionDetails' // 交易详情相关类型
import { currencyId } from 'uniswap/src/utils/currencyId' // 货币ID生成函数

/**
 * SwapResult类型
 * 表示调用useSwapCallback返回的函数执行后的结果类型
 * 是一个嵌套的ReturnType，因为useSwapCallback返回一个函数，该函数的返回值就是SwapResult
 */
export type SwapResult = Awaited<ReturnType<ReturnType<typeof useSwapCallback>>>

/**
 * UniversalRouterFeeField类型
 * 表示UniversalRouter交易中的费用字段
 * 可以是百分比费用选项或固定金额费用选项
 */
type UniversalRouterFeeField = { feeOptions: FeeOptions } | { flatFeeOptions: FlatFeeOptions }

/**
 * 根据交易对象获取UniversalRouter所需的费用字段
 * @param trade 交易对象，可能是不同类型的交易
 * @returns 费用字段对象或undefined（如果不需要费用或不是经典交易）
 */
function getUniversalRouterFeeFields(trade?: InterfaceTrade): UniversalRouterFeeField | undefined {
  // 检查是否为经典交易类型
  if (!isClassicTrade(trade)) {
    return undefined
  }
  // 检查是否有交易费用
  if (!trade.swapFee) {
    return undefined
  }

  // 根据交易类型返回不同的费用选项格式
  if (trade.tradeType === TradeType.EXACT_INPUT) {
    // 精确输入交易使用百分比费用
    return { feeOptions: { fee: trade.swapFee.percent, recipient: trade.swapFee.recipient } }
  } else {
    // 精确输出交易使用固定金额费用
    return { flatFeeOptions: { amount: BigNumber.from(trade.swapFee.amount), recipient: trade.swapFee.recipient } }
  }
}

/**
 * 交易执行Hook，返回一个执行交易的函数
 * 处理各种交易类型（经典交易、Uniswap X、限价订单等）
 * @param options 交易选项
 * @param options.trade 要执行的交易对象
 * @param options.fiatValues 法币价值，用于分析日志
 * @param options.allowedSlippage 允许的滑点百分比（以基点表示）
 * @param options.permitSignature 可选的授权签名，用于无Gas费授权
 * @returns 一个异步函数，调用后执行交易并返回结果
 */
export function useSwapCallback({
  trade,
  fiatValues,
  allowedSlippage,
  permitSignature,
}: {
  trade?: InterfaceTrade // 要执行的交易对象
  fiatValues: { amountIn?: number; amountOut?: number; feeUsd?: number } // 法币价值，用于分析日志
  allowedSlippage: Percent // 允许的滑点百分比
  permitSignature?: PermitSignature // 可选的授权签名
}) {
  // 获取各种Hook和状态
  const dispatch = useDispatch() // Redux dispatch函数
  const addClassicTransaction = useTransactionAdder() // 添加经典交易的函数
  const account = useAccount() // 当前账户信息
  const supportedConnectedChainId = useSupportedChainId(account.chainId) // 检查当前连接的链是否支持
  const { chainId: swapChainId } = useMultichainContext() // 获取交易链ID

  // 获取UniswapX交易回调函数
  const uniswapXSwapCallback = useUniswapXSwapCallback({
    trade: isUniswapXTrade(trade) ? trade : undefined, // 只在是UniswapX交易时传递
    allowedSlippage,
    fiatValues,
  })

  // 获取UniversalRouter交易回调函数（用于经典交易）
  const universalRouterSwapCallback = useUniversalRouterSwapCallback({
    trade: isClassicTrade(trade) ? trade : undefined, // 只在是经典交易时传递
    fiatValues,
    options: {
      slippageTolerance: allowedSlippage,
      permit: permitSignature, // 可选的授权签名
      ...getUniversalRouterFeeFields(trade), // 合并费用字段
    },
  })

  // 获取链选择函数
  const selectChain = useSelectChain()
  // 根据交易类型选择对应的交易回调函数
  const swapCallback = isUniswapXTrade(trade) ? uniswapXSwapCallback : universalRouterSwapCallback

  // 返回交易执行函数，使用useCallback缓存以避免不必要的重渲染
  return useCallback(async () => {
    // 参数验证
    if (!trade) {
      throw new Error('missing trade')
    } else if (!account.isConnected || !account.address) {
      throw new Error('wallet must be connected to swap')
    } else if (!swapChainId) {
      throw new Error('missing swap chainId')
    } else if (!isEVMChain(swapChainId)) {
      throw new Error('non EVM chain in legacy limits flow')
    } else if (!supportedConnectedChainId || supportedConnectedChainId !== swapChainId) {
      // 如果当前连接的链与交易链不一致，尝试切换链
      const correctChain = await selectChain(swapChainId)
      if (!correctChain) {
        throw new Error('wallet must be connected to correct chain to swap')
      }
    }
    // 执行交易
    const result = await swapCallback()

    // 构建交易信息对象
    const swapInfo: TransactionInfo = {
      type: TransactionType.Swap, // 交易类型为Swap
      inputCurrencyId: currencyId(trade.inputAmount.currency), // 输入货币ID
      outputCurrencyId: currencyId(trade.outputAmount.currency), // 输出货币ID
      isUniswapXOrder: result.type === TradeFillType.UniswapX || result.type === TradeFillType.UniswapXv2, // 是否为UniswapX订单
      // 根据交易类型添加不同的信息
      ...(trade.tradeType === TradeType.EXACT_INPUT
        ? {
            tradeType: TradeType.EXACT_INPUT,
            inputCurrencyAmountRaw: trade.inputAmount.quotient.toString(), // 输入金额
            expectedOutputCurrencyAmountRaw: trade.outputAmount.quotient.toString(), // 期望输出金额
            minimumOutputCurrencyAmountRaw: trade.minimumAmountOut(allowedSlippage).quotient.toString(), // 最低输出金额（考虑滑点）
          }
        : {
            tradeType: TradeType.EXACT_OUTPUT,
            maximumInputCurrencyAmountRaw: trade.maximumAmountIn(allowedSlippage).quotient.toString(), // 最大输入金额（考虑滑点）
            outputCurrencyAmountRaw: trade.outputAmount.quotient.toString(), // 输出金额
            expectedInputCurrencyAmountRaw: trade.inputAmount.quotient.toString(), // 期望输入金额
          }),
    }

    // 根据交易结果类型进行不同处理
    // 经典交易通过传统方式添加到交易列表
    if (result.type === TradeFillType.Classic) {
      addClassicTransaction(result.response, swapInfo, result.deadline?.toNumber())
    } 
    // 限价单需要手动添加，因为它们在初始提交时不通过saga流程
    else if (isLimitTrade(trade)) {
      // 创建限价单交易详情
      const limitOrderTransaction: UniswapXOrderDetails<InterfaceTransactionDetails> = {
        id: result.response.orderHash, // 订单哈希作为ID
        chainId: swapChainId,
        from: account.address!,
        status: TransactionStatus.Pending, // 初始状态为待处理
        addedTime: Date.now(), // 添加时间
        transactionOriginType: TransactionOriginType.Internal, // 内部生成的交易
        typeInfo: swapInfo,
        routing: TradingApi.Routing.DUTCH_LIMIT, // 使用荷兰式限价路由
        orderHash: result.response.orderHash,
        queueStatus: QueuedOrderStatus.Submitted, // 队列状态为已提交
        encodedOrder: result.response.encodedOrder, // 编码后的订单
        expiry: result.response.deadline, // 过期时间
      }

      // 分发添加交易的action
      dispatch(addTransaction(limitOrderTransaction))
    }

    // 返回交易结果
    return result
  }, [
    // 依赖数组，确保useCallback正确缓存
    account.address,
    account.isConnected,
    addClassicTransaction,
    allowedSlippage,
    dispatch,
    selectChain,
    supportedConnectedChainId,
    swapCallback,
    swapChainId,
    trade,
  ])
}

/**
 * 获取交易状态的Hook
 * 仅适用于经典交易类型
 * @param swapResult 交易执行结果
 * @returns 交易状态或undefined（如果没有交易结果或不是经典交易）
 */
export function useSwapTransactionStatus(swapResult: SwapResult | undefined): TransactionStatus | undefined {
  // 仅在交易结果类型为Classic时获取交易状态
  const transaction = useTransaction(swapResult?.type === TradeFillType.Classic ? swapResult.response.hash : undefined)
  if (!transaction) {
    return undefined
  }
  return transaction.status
}
