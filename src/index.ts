/* global process */

import * as crypto from 'crypto'
import { Config } from './types/Config'
import * as request from 'superagent'
import * as Logger from 'bunyan'

export class CSOBPaymentModule {
  private logger: Logger
  private config: Config

  constructor(config: Config = {}) {
    this.logger = config.logging ? config.logging : {
      info: (args) => {
        console.log(args)
      }
    } as Logger

    this.config = {
      gateUrl: config.gateUrl || process.env.GATEWAY_URL,
      privateKey: config.privateKey || process.env.MERCHANT_PRIVATE_KEY,
      merchantPublicKey: config.merchantPublicKey || process.env.MERCHANT_PUBLIC_KEY,
      bankPublicKey: config.bankPublicKey || process.env.BANK_PUBLIC_KEY,
      calbackUrl: config.calbackUrl || process.env.CALLBACK_URL,
      merchantId: config.merchantId || process.env.MERCHANT_ID
    }

    this.config.payloadTemplate = {
      merchantId: this.config.merchantId,
      payOperation: 'payment',
      payMethod: 'card',
      currency: 'CZK',
      language: 'CZ',
      returnUrl: this.config.calbackUrl,
      returnMethod: 'POST'
    }
  }

  // init - 1. krok - inicializace platby
  async init(payload) {
    payload['signature'] = this.sign(this.createPayloadMessage(payload))
    this.logger.info('init', payload)
    const result = await request({
      url: `${this.config.gateUrl}/payment/init`,
      method: 'POST',
      json: true,
      body: payload
    })
    if (this.verify(this.createResultMessage(result), result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('init failed', result)
      }
    }
    throw new Error('Init - Verification failed')

  }

  // process - 2.krok - redirect url
  getRedirectUrl(id: string) {
    const dttm = this.createDttm()
    const signature = this.sign(this.createMessageString({
      merchantId: this.config.merchantId,
      payId: id,
      dttm
    }))
    const url = `${this.config.gateUrl}/payment/process/${this.config.merchantId}/${id}/${dttm}/${encodeURIComponent(signature)}`
    this.logger.info('redirectUrl', url)
    return url
  }

  // status
  async status(id: string) {
    const dttm = this.createDttm()
    const signature = this.sign(this.createMessageString({
      merchantId: this.config.merchantId,
      payId: id,
      dttm
    }))

    const url = `${this.config.gateUrl}/payment/status/${this.config.merchantId}/${id}/${dttm}/${encodeURIComponent(signature)}`
    this.logger.info('status', url)
    const result = request({
      url,
      method: 'GET',
      json: true
    })
    const message = this.createResultMessage(result)

    if (this.verify(message, result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('status failed', result)
      }
    }
    throw new Error('Status - Verification failed')
  }

  // reverse
  public async reverse(id: string) {
    const payload = {
      merchantId: this.config.merchantId,
      payId: id,
      dttm: this.createDttm()
    }

    payload['signature'] = this.sign(this.createMessageString(payload))
    this.logger.info('reverse', payload)
    const result = request({
      url: `${this.config.gateUrl}/payment/reverse`,
      method: 'PUT',
      json: true,
      body: payload
    })
    if (this.verify(this.createResultMessage(result), result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('reverse failed', result)
      }
    }
    throw new Error('Reverse - Verification failed')

  }

// close
  close(id: string, amount: number) {
    const payload = {
      merchantId: this.config.merchantId,
      payId: id,
      dttm: this.createDttm(),
      amount
    }

    payload['signature'] = this.sign(this.createMessageString(payload))
    this.logger.info('close', payload)
    const result = request({
      url: `${this.config.gateUrl}/payment/close`,
      method: 'PUT',
      json: true,
      body: payload
    })
    if (this.verify(this.createResultMessage(result), result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('close failed', result)
      }
    }
    throw new Error('Close - Verification failed')

  }

// refund
  async refund(id: string, amount: number) {
    const payload = {
      merchantId: this.config.merchantId,
      payId: id,
      dttm: this.createDttm(),
      amount
    }

    payload['signature'] = this.sign(this.createMessageString(payload))
    this.logger.info('refund', payload)
    const result = request({
      url: `${this.config.gateUrl}/payment/refund`,
      method: 'PUT',
      json: true,
      body: payload
    })
    if (this.verify(this.createResultMessage(result), result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('refund failed', result)
      }
    }
    throw new Error('Refund - Verification failed')
  }

// refund
  public async echo(method = 'POST') {
    const payload = {
      merchantId: this.config.merchantId,
      dttm: this.createDttm(),
      signature: null
    }

    payload['signature'] = this.sign(this.createMessageString(payload))
    this.logger.info('echo', payload)
    let result
    if (method === 'POST') {
      result = await request({
        url: `${this.config.gateUrl}/echo`,
        method: 'POST',
        json: true,
        body: payload
      })
    } else {
      result = await request({
        url: `${this.config.gateUrl}/echo/${payload.merchantId}/${payload.dttm}/${encodeURIComponent(payload.signature)}`,
        method: 'GET',
        json: true
      })
    }
    if (this.verify(this.createResultMessage(result), result.signature)) {
      if (result.resultCode.toString() === '0') {
        return result
      } else {
        throw new GatewayError('echo failed', result)
      }
    }
    throw new Error('Echo - Verification failed')
  }

  public async payOrder(order, close = true, options = {}) {
    const payload = Object.assign(options, this.config.payloadTemplate)
    payload['orderNo'] = order.id
    payload['dttm'] = this.createDttm()
    payload['description'] = order.description
    payload['cart'] = order.items
    payload['totalAmount'] = order.items.reduce((sum, item) => sum + item.amount, 0)
    payload['closePayment'] = close
    if (order.merchantData) {
      payload['merchantData'] = Buffer.from(order.merchantData).toString('base64')
    }
    this.logger.info('payOrder', payload)
    const result = await this.init(payload)
    this.logger.info('payOrder - result', result)
    return this.getRedirectUrl(result.payId)
  }

  public async verifyResult(result) {
    if (result.resultCode.toString() === '0') {
      if (this.verify(this.createResultMessage(result), result.signature)) {
        this.logger.info('verifyResult', result)
        result['merchantData'] = Buffer.from(result.merchantData, 'base64').toString('ascii')
        return result
      } else {
        throw new GatewayError('Verification failed')
      }
    }
  }

  private prefixNumber(num: number) {
    return num < 10 ? '0' + num : num
  }

  private createDttm() {
    const date = new Date()
    return `${date.getFullYear()}${this.prefixNumber(date.getMonth())}` +
      `${this.prefixNumber(date.getDay())}${this.prefixNumber(date.getHours())}` +
      `${this.prefixNumber(date.getMinutes())}${this.prefixNumber(date.getSeconds())}`
  }

  private sign(text: string) {
    return crypto.createSign('sha1').update(text).sign(this.config.privateKey, 'base64')
  }

  private verify(text: string, signature: string) {
    return crypto.createVerify('sha1').update(text).verify(this.config.bankPublicKey, signature, 'base64')
  }

  private createMessageArray(data, keys) {
    if (!keys) {
      keys = Object.keys(data)
    }
    return keys.map(key => data[key]).filter(item => typeof (item) !== 'undefined')
  }

  private createMessageString(data, keys = []) {
    return this.createMessageArray(data, keys).join('|')
  }

  private createPayloadMessage(payload) {

    const payloadKeys = [
      'merchantId', 'orderNo', 'dttm', 'payOperation', 'payMethod',
      'totalAmount', 'currency', 'closePayment', 'returnUrl', 'returnMethod'
    ]
    const cartItemKeys = [ 'name', 'quantity', 'amount', 'description' ]
    let payloadMessageArray = this.createMessageArray(payload, payloadKeys)
    payload.cart.forEach(cartItem => {
      payloadMessageArray = payloadMessageArray.concat(this.createMessageArray(cartItem, cartItemKeys))
    })
    payloadMessageArray = payloadMessageArray.concat(this.createMessageArray(payload, [
      'description', 'merchantData', 'customerId', 'language', 'ttlSec', 'logoVersion', 'colorSchemeVersion'
    ]))
    return payloadMessageArray.join('|')
  }

  private createResultMessage(result) {
    const resultKeys = [
      'payId', 'dttm', 'resultCode', 'resultMessage', 'paymentStatus', 'authCode', 'merchantData'
    ]
    return this.createMessageString(result, resultKeys)
  }
}